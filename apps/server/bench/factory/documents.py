"""The corpus factory's pure core: build a document AND its ground truth together.

`docs/CORPUS.md` §5. This module has **no rendering and no image dependencies**
— it produces a `SyntheticDoc` whose values ARE the ground truth, and
`render.py` draws exactly those values. That ordering is the whole design:

    **We never label a synthetic document. The generator knows the truth
    because it chose it.**

`docs/CORPUS.md` §5.2 records why that rule exists. An earlier gold set was
hand-labelled and asserted regions were `illegible` that PP-OCRv5 read
correctly, producing two false `CONFIDENT_WRONG` results — *a ground truth that
asserts what an engine cannot do is a claim about the engine and must be
checked like one.* Truth chosen before the pixels exist cannot make that
mistake.

MONEY IS A DECIMAL, NEVER A FLOAT. `docs/PLAN.md` principle 4: figures are
rendered from strings and never parsed to a float, because a BAS out by a cent
is wrong. The same rule applies to the corpus that grades the engine — a ground
truth computed in binary floating point would be wrong in exactly the cases the
validators exist to catch.

THE WEDGE IS IN HERE. `supermarket` mixes GST-free fresh food with taxable
packaged goods on one docket, and every document carries `tax_subtotals` — the
per-category split (Peppol BG-23) that `docs/MONETISATION.md` §2 identifies as
the one capability no competitor at any price offers. A corpus that cannot
measure the wedge cannot prove the product's central claim.
"""
from __future__ import annotations

import os
import random
import sys
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import abn as abn_mod  # noqa: E402

# Australian GST is 1/11 of a GST-INCLUSIVE price. Named rather than inlined so
# the one place it could be mistyped is greppable.
GST_DIVISOR = Decimal(11)
CENTS = Decimal('0.01')

TAX_GST = 'GST'   # taxable at 10%
TAX_FRE = 'FRE'   # GST-free (fresh food, most basic groceries)


def money(value) -> Decimal:
    """A money amount, quantised to cents, half-up — never binary float."""
    return Decimal(str(value)).quantize(CENTS, rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class Line:
    description: str
    amount: Decimal          # GST-INCLUSIVE, as printed on an AU docket
    tax_code: str            # TAX_GST | TAX_FRE


@dataclass
class SyntheticDoc:
    """A document and its truth. Everything printed is derived from these fields."""
    doc_id: str
    archetype: str
    supplier_name: str
    supplier_abn: str | None
    address: str
    issue_date: date
    lines: tuple[Line, ...]
    says_tax_invoice: bool
    prints_gst_line: bool
    invoice_no: str
    payment_method: str
    operator: str | None
    date_is_ambiguous: bool   # day <= 12, so dd/mm could be misread as mm/dd

    # ── derived truth ────────────────────────────────────────────────────────

    def total_inclusive(self) -> Decimal:
        return money(sum((l.amount for l in self.lines), Decimal(0)))

    def taxable_subtotal(self) -> Decimal:
        return money(sum((l.amount for l in self.lines if l.tax_code == TAX_GST), Decimal(0)))

    def free_subtotal(self) -> Decimal:
        return money(sum((l.amount for l in self.lines if l.tax_code == TAX_FRE), Decimal(0)))

    def gst_amount(self) -> Decimal | None:
        """GST on the TAXABLE portion only, computed on the subtotal.

        Computed on the subtotal rather than per line, because that is how an
        AU docket prints it and per-line rounding would not re-add to the
        printed figure. A document that prints no GST line has `None` — the
        abstention case, and the correct answer is null, not a computed guess.

        This is also the rule the on-device preview must obey
        (docs/ON-DEVICE.md §3.4): never compute GST the paper does not carry.
        """
        if not self.prints_gst_line:
            return None
        return money(self.taxable_subtotal() / GST_DIVISOR)

    def tax_subtotals(self) -> list[dict]:
        """Per-category subtotals — Peppol BG-23, the capability no competitor has.

        One entry per tax category actually present, each with its taxable
        (inclusive) amount and the GST attributable to it. A GST-free category
        contributes 0.00 tax, and saying so explicitly is the point: "which half
        of this docket is claimable" is the question being answered.
        """
        out: list[dict] = []
        for code in (TAX_GST, TAX_FRE):
            amount = money(sum((l.amount for l in self.lines if l.tax_code == code), Decimal(0)))
            if amount == 0:
                continue
            tax = money(amount / GST_DIVISOR) if (code == TAX_GST and self.prints_gst_line) else money(0)
            out.append({
                'tax_code': code,
                'inclusive_amount': str(amount),
                'tax_amount': str(tax),
            })
        return out

    def is_mixed(self) -> bool:
        """Does this docket carry both taxable and GST-free lines? The wedge case."""
        codes = {l.tax_code for l in self.lines}
        return TAX_GST in codes and TAX_FRE in codes


# ── Catalogues ───────────────────────────────────────────────────────────────
# GST treatment follows the actual Australian rule, because the corpus is also
# how we prove we apply it: basic unprocessed food is GST-free; prepared food,
# confectionery, snacks, soft drinks and every non-food good are taxable.

FRESH_FOOD = [  # GST-free
    ('BANANAS 1.2KG', '4.68'), ('CARROTS 1KG', '2.20'), ('BROWN ONIONS 1KG', '3.50'),
    ('FULL CREAM MILK 2L', '3.30'), ('WHITE BREAD 700G', '3.10'), ('FREE RANGE EGGS 12', '7.50'),
    ('CHICKEN BREAST 1KG', '12.00'), ('BEEF MINCE 500G', '9.50'), ('WHITE RICE 1KG', '3.20'),
    ('PLAIN FLOUR 1KG', '2.40'), ('TOMATOES 500G', '4.50'), ('POTATOES 2KG', '5.90'),
]

PACKAGED_GOODS = [  # taxable
    ('COCA COLA 1.25L', '3.10'), ('SMITHS CHIPS 170G', '4.50'), ('TIM TAMS 200G', '4.20'),
    ('DISHWASHING LIQUID', '4.80'), ('PAPER TOWEL 2PK', '5.50'), ('ICE 2KG', '4.90'),
    ('ENERGY DRINK 500ML', '4.30'), ('CHOC BAR 50G', '2.80'), ('LAUNDRY POWDER 1KG', '11.00'),
    ('GARBAGE BAGS 30PK', '6.40'),
]

FUEL_ITEMS = [
    ('DIESEL {l}L @ {p}', None), ('UNLEADED 91 {l}L @ {p}', None), ('PREMIUM 98 {l}L @ {p}', None),
]
FUEL_EXTRAS = [
    ('ADBLUE 10L', '18.50'), ('COFFEE LGE', '4.50'), ('MEAT PIE', '6.20'),
    ('WINDSCREEN WASH', '9.90'), ('OIL 1L', '14.50'),
]

HARDWARE_ITEMS = [
    ('TIMBER PINE 90X45 2.4M', '14.80'), ('GAL SCREWS 500PK', '28.90'), ('SILICONE CLEAR', '12.40'),
    ('DROP SHEET 3.6X2.7', '9.95'), ('PAINT ROLLER KIT', '22.50'), ('SAFETY GLASSES', '11.00'),
    ('GLOVES XL 3PK', '16.90'), ('MASONRY BIT 8MM', '13.20'), ('CABLE TIES 200PK', '8.40'),
    ('EXT LEAD 10M', '39.90'), ('CONSTRUCTION ADHESIVE', '17.60'), ('TARP 4X6', '34.00'),
]

CAFE_ITEMS = [
    ('FLAT WHITE LGE', '5.50'), ('CAPPUCCINO REG', '4.80'), ('BACON EGG ROLL', '12.50'),
    ('BANANA BREAD', '5.00'), ('ICED LATTE', '6.20'), ('CHICKEN WRAP', '13.90'),
]

TRADE_ITEMS = [
    ('Freight: Melbourne -> Sydney', '640.00'), ('Fuel levy', '76.50'), ('Depot handling fee', '110.00'),
    ('Pallet hire x4', '88.00'), ('After-hours surcharge', '145.00'), ('Tail-lift service', '65.00'),
    ('Freight: Sydney -> Brisbane', '580.00'), ('Insurance surcharge', '42.50'),
    ('Waiting time 2hrs', '180.00'), ('Re-delivery fee', '95.00'),
]

TELCO_ITEMS = [
    ('Mobile plan — 80GB', '55.00'), ('Excess data 2GB', '20.00'), ('International calls', '13.40'),
    ('Device repayment', '33.00'),
]

SUPPLIER_NAMES = {
    'supermarket': ['Riverton Fresh Market', 'Kalinda Grocers', 'Hillview Food Store',
                    'Parkside Supa Mart', 'Brennan Street Grocery'],
    'fuel': ['Gundagai Roadhouse', 'Marulan Truckstop', 'Coolac Service Centre',
             'Tarcutta Fuel Depot', 'Yass Valley Servo'],
    'hardware': ['Tradepoint Building Supplies', 'Norwood Hardware Co',
                 'Bayline Timber & Trade', 'Kembla Trade Centre'],
    'cafe': ['The Sidings Cafe', 'Corner Lane Coffee', 'Foxton Street Espresso',
             'Rivergum Coffee House'],
    'trade_invoice': ['Southern Cross Logistics Pty Ltd', 'Ardmore Freight Services Pty Ltd',
                      'Cavanagh Transport Pty Ltd', 'Westmead Haulage Pty Ltd'],
    'telco': ['Lightwire Communications Pty Ltd', 'Tandem Mobile Australia Pty Ltd'],
    'no_abn_van': ['Roadside Coffee Van', 'The Little Food Truck', 'Riverbank Snack Trailer'],
}

STREETS = ['Sheridan St', 'Hume Hwy', 'Bourke St', 'Parkes Rd', 'Manning St', 'Coronation Dr']
TOWNS = [('Gundagai', 'NSW', '2722'), ('Marulan', 'NSW', '2579'), ('Shepparton', 'VIC', '3630'),
         ('Toowoomba', 'QLD', '4350'), ('Bunbury', 'WA', '6230'), ('Elizabeth', 'SA', '5112')]
OPERATORS = ['JODIE', 'MARK', 'SAV', 'TRENT', 'KELLY', 'AMIR', 'BEC']
PAYMENTS = ['VISA ****4417', 'EFTPOS SAV', 'MASTERCARD ****8830', 'CASH', 'AMEX ****1002']

ARCHETYPES = ('supermarket', 'fuel', 'hardware', 'cafe', 'trade_invoice', 'telco', 'no_abn_van')


def _pick_lines(rng: random.Random, archetype: str) -> list[Line]:
    if archetype == 'supermarket':
        # The wedge: ALWAYS mixed. Both halves present, so the per-category
        # split is measurable on every supermarket document in the corpus.
        n_fresh = rng.randint(2, 6)
        n_packaged = rng.randint(2, 6)
        lines = [Line(d, money(a), TAX_FRE) for d, a in rng.sample(FRESH_FOOD, n_fresh)]
        lines += [Line(d, money(a), TAX_GST) for d, a in rng.sample(PACKAGED_GOODS, n_packaged)]
        rng.shuffle(lines)
        return lines

    if archetype == 'fuel':
        litres = Decimal(str(rng.randint(28, 140))) + Decimal(str(rng.randint(0, 99))) / 100
        price = Decimal(str(rng.choice(['1.719', '1.829', '1.899', '2.049', '2.113'])))
        desc = rng.choice(['DIESEL', 'UNLEADED 91', 'PREMIUM 98'])
        lines = [Line(f'{desc} {litres}L @ {price}', money(litres * price), TAX_GST)]
        for d, a in rng.sample(FUEL_EXTRAS, rng.randint(0, 3)):
            lines.append(Line(d, money(a), TAX_GST))
        return lines

    if archetype == 'hardware':
        return [Line(d, money(a), TAX_GST)
                for d, a in rng.sample(HARDWARE_ITEMS, rng.randint(2, 9))]

    if archetype == 'cafe':
        return [Line(d, money(a), TAX_GST)
                for d, a in rng.sample(CAFE_ITEMS, rng.randint(1, 4))]

    if archetype == 'trade_invoice':
        # Deliberately long: a 40-line invoice is how the multi-page case arises.
        picks = [rng.choice(TRADE_ITEMS) for _ in range(rng.randint(6, 40))]
        return [Line(f'{d} ({i + 1:02d})', money(a), TAX_GST) for i, (d, a) in enumerate(picks)]

    if archetype == 'telco':
        return [Line(d, money(a), TAX_GST)
                for d, a in rng.sample(TELCO_ITEMS, rng.randint(2, 4))]

    if archetype == 'no_abn_van':
        return [Line(d, money(a), TAX_GST)
                for d, a in rng.sample(CAFE_ITEMS, rng.randint(1, 3))]

    raise ValueError(f'unknown archetype {archetype!r}')


def build(rng: random.Random, archetype: str, index: int) -> SyntheticDoc:
    """One document, with its truth, chosen before a single pixel exists."""
    lines = _pick_lines(rng, archetype)

    # `no_abn_van` is the abstention case: no ABN printed, no tax-invoice
    # wording, no GST line. The correct reading of all three is null/false, and
    # a model that fills any of them in is hallucinating, not reading.
    if archetype == 'no_abn_van':
        supplier_abn = None
        says_tax_invoice = False
        prints_gst_line = False
    else:
        supplier_abn = abn_mod.derive_valid_abn(f'{rng.randint(0, 999_999_999):09d}')
        says_tax_invoice = True
        prints_gst_line = True

    day = rng.randint(1, 28)
    issue = date(2026, rng.randint(1, 9), day) - timedelta(days=rng.randint(0, 20))
    street, (town, state, pc) = rng.choice(STREETS), rng.choice(TOWNS)

    return SyntheticDoc(
        doc_id=f'gen-{archetype}-{index:04d}',
        archetype=archetype,
        supplier_name=rng.choice(SUPPLIER_NAMES[archetype]),
        supplier_abn=supplier_abn,
        address=f'{rng.randint(1, 400)} {street}, {town} {state} {pc}',
        issue_date=issue,
        lines=tuple(lines),
        says_tax_invoice=says_tax_invoice,
        prints_gst_line=prints_gst_line,
        invoice_no=f'{rng.randint(10_000, 99_999)}',
        payment_method=rng.choice(PAYMENTS),
        operator=rng.choice(OPERATORS) if archetype in ('supermarket', 'fuel', 'cafe') else None,
        # A day <= 12 could be read as a month by a reader assuming US order.
        # `validators.ts` gates this on whether it changes the BAS quarter; the
        # corpus records the ambiguity so a run can be scored on it rather than
        # penalised for it.
        date_is_ambiguous=issue.day <= 12,
    )


def manifest_entry(doc: SyntheticDoc, pages: list[str], fmt: str, degradation: str) -> dict:
    """The manifest entry, emitted by construction — never hand-edited (§5.2).

    Shape matches the committed `manifest.json` exactly, so `scoring.py` and
    `compare.py` consume it with no changes: `fields` with per-field `compare`
    comparators, `lines.truth`, plus the `provenance` block `provenance.py`
    requires. `tax_subtotals` is additive; the scorers ignore keys they do not
    know, and it is what makes the wedge measurable.
    """
    gst = doc.gst_amount()
    return {
        'id': doc.doc_id,
        'provenance': {
            'tier': 'S',
            'source': (
                f'factory: archetype={doc.archetype}, degradation={degradation}. '
                'Rendered from a generated DOM; ground truth chosen by the generator '
                'before rendering, never read back from the image (docs/CORPUS.md §5.2).'
            ),
            'licence': 'ours',
            'captured_in': None,
            'pii_reviewed': True,
        },
        'format': fmt,
        'pages': pages,
        'archetype': doc.archetype,
        'degradation': degradation,
        'mixed_tax': doc.is_mixed(),
        'date_is_ambiguous': doc.date_is_ambiguous,
        'fields': {
            'supplier_name': {'truth': doc.supplier_name, 'compare': 'text'},
            'supplier_abn': {'truth': doc.supplier_abn, 'compare': 'digits'},
            'issue_date': {'truth': doc.issue_date.isoformat(), 'compare': 'exact'},
            'total_inclusive': {'truth': str(doc.total_inclusive()), 'compare': 'amount'},
            'gst_amount': {'truth': (str(gst) if gst is not None else None), 'compare': 'amount'},
            'is_tax_invoice': {'truth': doc.says_tax_invoice, 'compare': 'bool'},
            'line_count': {'truth': len(doc.lines), 'compare': 'int'},
            'page_count': {'truth': len(pages), 'compare': 'int'},
        },
        'tax_subtotals': {'truth': doc.tax_subtotals()},
        'lines': {
            'truth': [
                {'description': l.description, 'amount': str(l.amount)}
                for l in doc.lines
            ]
        },
    }
