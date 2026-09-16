"""Tests for the corpus factory's truth (docs/CORPUS.md §5).

Run from apps/server/bench/:
    python -m unittest factory.test_documents -v

These matter more than most tests in this repository. Every accuracy number the
engine ever reports is scored against what this module emits, so an arithmetic
error here does not fail — it silently grades the engine against the wrong
answer, and the engine looks wrong when it was right. That is the same class of
defect as the hand-labelled gold set in `docs/OCR.md` §8.1 that asserted regions
were illegible which PP-OCRv5 read correctly.

So the arithmetic is pinned against hand-computed values, not against the
implementation's own output.
"""
from __future__ import annotations

import random
import unittest
from decimal import Decimal

from . import documents as D


def _doc(lines, prints_gst=True, says_ti=True):
    return D.SyntheticDoc(
        doc_id='t', archetype='supermarket', supplier_name='S', supplier_abn='51824753556',
        address='a', issue_date=__import__('datetime').date(2026, 3, 14), lines=tuple(lines),
        says_tax_invoice=says_ti, prints_gst_line=prints_gst, invoice_no='1',
        payment_method='CASH', operator=None, date_is_ambiguous=False,
    )


class MoneyIsNeverAFloat(unittest.TestCase):
    def test_amounts_are_decimals(self):
        self.assertIsInstance(D.money('4.68'), Decimal)

    def test_a_classic_binary_float_error_does_not_occur(self):
        # 0.1 + 0.2 == 0.30000000000000004 in binary floating point. A BAS out
        # by a cent is wrong (docs/PLAN.md principle 4), and the corpus that
        # grades the engine must not itself be out by one.
        doc = _doc([D.Line('a', D.money('0.10'), D.TAX_GST),
                    D.Line('b', D.money('0.20'), D.TAX_GST)])
        self.assertEqual(doc.total_inclusive(), Decimal('0.30'))
        self.assertEqual(str(doc.total_inclusive()), '0.30')

    def test_rounding_is_half_up_not_bankers(self):
        # Python's round() is banker's rounding: round(2.675, 2) -> 2.67.
        # Money is not rounded that way.
        self.assertEqual(D.money('2.675'), Decimal('2.68'))


class GstIsOneEleventhOfTheTaxablePortionOnly(unittest.TestCase):
    def test_a_fully_taxable_docket(self):
        doc = _doc([D.Line('x', D.money('110.00'), D.TAX_GST)])
        self.assertEqual(doc.total_inclusive(), Decimal('110.00'))
        self.assertEqual(doc.gst_amount(), Decimal('10.00'))  # 110/11, by hand

    def test_a_fully_gst_free_docket_has_zero_gst(self):
        doc = _doc([D.Line('bananas', D.money('4.68'), D.TAX_FRE)])
        self.assertEqual(doc.gst_amount(), Decimal('0.00'))

    def test_a_mixed_docket_taxes_only_the_taxable_half(self):
        # THE WEDGE. $22.00 taxable + $10.00 GST-free = $32.00 total, and the
        # GST is 22/11 = 2.00 — NOT 32/11 = 2.909..., which is what a tool that
        # reads only the header total would compute.
        doc = _doc([
            D.Line('chips', D.money('22.00'), D.TAX_GST),
            D.Line('bananas', D.money('10.00'), D.TAX_FRE),
        ])
        self.assertEqual(doc.total_inclusive(), Decimal('32.00'))
        self.assertEqual(doc.taxable_subtotal(), Decimal('22.00'))
        self.assertEqual(doc.free_subtotal(), Decimal('10.00'))
        self.assertEqual(doc.gst_amount(), Decimal('2.00'))
        self.assertNotEqual(doc.gst_amount(), D.money(Decimal('32.00') / 11))

    def test_a_document_printing_no_gst_line_has_null_gst_not_zero(self):
        # null is "the paper does not carry this", which is an abstention case.
        # 0.00 would be a claim that GST was printed as zero. Different facts.
        doc = _doc([D.Line('coffee', D.money('5.50'), D.TAX_GST)], prints_gst=False)
        self.assertIsNone(doc.gst_amount())


class TaxSubtotalsAreTheCapabilityNobodyElseHas(unittest.TestCase):
    def test_a_mixed_docket_splits_per_category(self):
        doc = _doc([
            D.Line('chips', D.money('22.00'), D.TAX_GST),
            D.Line('bananas', D.money('10.00'), D.TAX_FRE),
        ])
        subs = {s['tax_code']: s for s in doc.tax_subtotals()}
        self.assertEqual(subs['GST']['inclusive_amount'], '22.00')
        self.assertEqual(subs['GST']['tax_amount'], '2.00')
        self.assertEqual(subs['FRE']['inclusive_amount'], '10.00')
        self.assertEqual(subs['FRE']['tax_amount'], '0.00')

    def test_categories_not_present_are_omitted(self):
        doc = _doc([D.Line('chips', D.money('22.00'), D.TAX_GST)])
        self.assertEqual([s['tax_code'] for s in doc.tax_subtotals()], ['GST'])

    def test_the_subtotals_re_add_to_the_total(self):
        doc = _doc([
            D.Line('a', D.money('13.37'), D.TAX_GST),
            D.Line('b', D.money('4.68'), D.TAX_FRE),
            D.Line('c', D.money('9.91'), D.TAX_GST),
        ])
        total = sum(Decimal(s['inclusive_amount']) for s in doc.tax_subtotals())
        self.assertEqual(total, doc.total_inclusive())


class EveryGeneratedAbnIsChecksumValid(unittest.TestCase):
    def test_across_many_seeds(self):
        import abn as abn_mod
        rng = random.Random(7)
        seen = 0
        for i in range(60):
            doc = D.build(rng, rng.choice(D.ARCHETYPES), i)
            if doc.supplier_abn is None:
                continue
            seen += 1
            self.assertTrue(
                abn_mod.abn_is_valid(doc.supplier_abn),
                f'{doc.doc_id} produced ABN {doc.supplier_abn} which fails mod-89',
            )
        self.assertGreater(seen, 0, 'no ABNs were generated at all — the test proved nothing')


class TheSupermarketArchetypeIsAlwaysMixed(unittest.TestCase):
    """If this ever stops holding, the corpus stops being able to measure the wedge."""

    def test_every_supermarket_document_carries_both_halves(self):
        rng = random.Random(11)
        for i in range(40):
            doc = D.build(rng, 'supermarket', i)
            self.assertTrue(doc.is_mixed(), f'{doc.doc_id} is not a mixed docket')
            codes = {s['tax_code'] for s in doc.tax_subtotals()}
            self.assertEqual(codes, {'GST', 'FRE'})


class TheAbstentionArchetypeAbstains(unittest.TestCase):
    def test_no_abn_van_has_null_abn_false_tax_invoice_and_null_gst(self):
        rng = random.Random(3)
        for i in range(10):
            doc = D.build(rng, 'no_abn_van', i)
            self.assertIsNone(doc.supplier_abn)
            self.assertFalse(doc.says_tax_invoice)
            self.assertIsNone(doc.gst_amount())


class GenerationIsReproducible(unittest.TestCase):
    def test_the_same_seed_yields_the_same_documents(self):
        def run():
            rng = random.Random(1234)
            return [D.manifest_entry(D.build(rng, a, i), ['p.png'], 'image', 'clean')
                    for i, a in enumerate(D.ARCHETYPES)]
        self.assertEqual(run(), run())

    def test_a_different_seed_yields_different_documents(self):
        a = D.build(random.Random(1), 'hardware', 0)
        b = D.build(random.Random(2), 'hardware', 0)
        self.assertNotEqual((a.supplier_name, a.lines), (b.supplier_name, b.lines))


class TheManifestEntryMatchesTheCommittedShape(unittest.TestCase):
    def setUp(self):
        self.entry = D.manifest_entry(
            D.build(random.Random(5), 'supermarket', 0), ['corpus/generated/x.png'], 'image', 'clean'
        )

    def test_it_passes_the_provenance_control(self):
        import provenance as prov
        prov.assert_manifest_provenance_valid({'documents': [self.entry]})

    def test_it_passes_the_abn_control(self):
        import abn as abn_mod
        abn_mod.assert_manifest_abns_valid({'documents': [self.entry]})

    def test_it_scores_cleanly_against_a_perfect_reader(self):
        # The strongest check available without rendering: feed the truth back
        # as if a reader had returned it, and every field must score EXACT or
        # ABSTAIN_OK. If the entry's shape or comparators were wrong, this is
        # where it shows.
        import scoring
        got = {name: spec['truth'] for name, spec in self.entry['fields'].items()}
        got['lines'] = self.entry['lines']['truth']
        ds = scoring.score_document(self.entry, got)
        self.assertTrue(ds.field_pass(), ds.outcomes)
        self.assertEqual(ds.lines_matched, ds.lines_total)

    def test_a_reader_that_invents_gst_on_an_abstention_case_is_marked_hallucinated(self):
        import scoring
        entry = D.manifest_entry(
            D.build(random.Random(9), 'no_abn_van', 0), ['x.png'], 'image', 'clean'
        )
        got = {name: spec['truth'] for name, spec in entry['fields'].items()}
        got['supplier_abn'] = '51824753556'   # invented
        ds = scoring.score_document(entry, got)
        self.assertEqual(ds.outcomes['supplier_abn'], scoring.HALLUCINATED)


if __name__ == '__main__':
    unittest.main()
