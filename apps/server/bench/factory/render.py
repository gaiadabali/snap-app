"""Draw a SyntheticDoc. Every printed value comes from the document's truth.

`docs/CORPUS.md` §5. Two templates, because Australian paperwork comes in two
physical shapes and they fail differently:

  * **thermal** — a narrow roll, monospace, dashed rules. Supermarket, fuel,
    cafe, the no-ABN van. This is the hard case and the one the product is
    pitched on.
  * **invoice** — A4, proportional type, a line-item table. Trade invoices and
    telco bills. Long ones paginate, which is how the multi-page case arises —
    and the totals land on the LAST page, so a reader that stops after page one
    cannot get them right.

The rule this file must never break: **it prints `doc`'s values and adds
nothing.** If a number appears on the page that is not in the truth, the corpus
is lying about what the image contains. Anything decorative (an operator name,
a loyalty line, a pump number) is deliberately NOT a scored field.
"""
from __future__ import annotations

import html
import os

from .documents import SyntheticDoc, TAX_FRE

HERE = os.path.dirname(os.path.abspath(__file__))

# Paper backgrounds and a slight rotation, so the render is "photographed
# document" rather than "screenshot" even before degrade.py touches it.
# `padding` rather than `min-height`: with full_page the page grows to fit its
# content, so the capture is the document plus a margin of surface — a photo of
# a docket, framed as someone would frame it.
#
# The earlier version pinned a 900px min-height inside a 960px viewport, so a
# 300px-wide thermal docket occupied about an eighth of a 1920x2200 frame. That
# is not merely wasteful: ML Kit wants >=16px per character (docs/ON-DEVICE.md
# §3.3), and a reader that downscales the whole frame to a fixed long edge
# spends its resolution budget on empty background. Caught by looking at the
# output rather than by a test.
_SCENE_CSS = """
  html, body { margin:0; }
  body { background:#3a3d42; display:flex; align-items:center;
         justify-content:center; padding:%(pad)dpx; }
  .scene { transform: rotate(%(rot).2fdeg) perspective(900px) rotateX(%(tilt).1fdeg); }
"""

_THERMAL_CSS = """
  .paper { width:%(width)dpx; padding:22px 20px; background:#fdfbf4; color:#23262b;
           font-family:'Courier New',monospace; font-size:12px; line-height:1.55;
           box-shadow:0 18px 40px rgba(0,0,0,.55);
           background-image:repeating-linear-gradient(0deg, rgba(0,0,0,.014) 0 2px, transparent 2px 4px); }
  .c { text-align:center; } .b { font-weight:bold; }
  .row { display:flex; justify-content:space-between; gap:10px; }
  .row span:last-child { white-space:nowrap; }
  .rule { border-top:1px dashed #6b6f76; margin:8px 0; }
  .big { font-size:15px; } .fade { color:#4c5058; }
  .gstflag { font-size:10px; color:#4c5058; }
"""

_INVOICE_CSS = """
  .paper { width:%(width)dpx; padding:44px 46px; background:#fffef9; color:#1a1d22;
           font-family:'Helvetica Neue',Arial,sans-serif; font-size:12px; line-height:1.5;
           box-shadow:0 18px 40px rgba(0,0,0,.5); }
  .hdr { display:flex; justify-content:space-between; align-items:flex-start; }
  .name { font-size:19px; font-weight:700; letter-spacing:-.01em; }
  .ti { font-size:15px; font-weight:700; letter-spacing:.14em; text-align:right; }
  .meta { margin-top:2px; color:#4a5059; font-size:11px; }
  table { width:100%%; border-collapse:collapse; margin-top:26px; }
  th { text-align:left; font-size:10px; letter-spacing:.09em; text-transform:uppercase;
       color:#5a6068; border-bottom:1.5px solid #2a2f36; padding:0 0 6px; }
  th.r, td.r { text-align:right; }
  td { padding:7px 0; border-bottom:1px solid #e2ded5; font-size:12px; }
  .totals { margin-top:18px; margin-left:auto; width:250px; }
  .totals .row { display:flex; justify-content:space-between; padding:5px 0; }
  .totals .grand { border-top:1.5px solid #2a2f36; margin-top:5px; padding-top:9px;
                   font-weight:700; font-size:15px; }
"""


def _money(v) -> str:
    return f'{v:,.2f}'


def _fmt_date(doc: SyntheticDoc) -> str:
    """Day-first, as Australian documents print it."""
    return doc.issue_date.strftime('%d/%m/%Y')


def _e(s) -> str:
    return html.escape(str(s))


def thermal_html(doc: SyntheticDoc, rot: float, width: int = 300) -> str:
    rows = []
    for line in doc.lines:
        # The GST flag column is how a real AU supermarket docket marks which
        # lines carried tax — and it is precisely the signal a header-only
        # reader throws away. Printed ONLY where the document prints a GST line.
        flag = ''
        if doc.prints_gst_line and doc.archetype == 'supermarket':
            flag = ' *' if line.tax_code != TAX_FRE else '  '
        rows.append(
            f'<div class="row"><span>{_e(line.description)}{_e(flag)}</span>'
            f'<span>{_money(line.amount)}</span></div>'
        )

    gst = doc.gst_amount()
    gst_block = ''
    if gst is not None:
        gst_block = (
            f'<div class="row"><span>GST INCLUDED</span><span>{_money(gst)}</span></div>'
        )
        if doc.is_mixed():
            # Both halves printed, because "which half is claimable" is the
            # question the product answers and the corpus has to contain it.
            gst_block += (
                f'<div class="row gstflag"><span>* TAXABLE SUBTOTAL</span>'
                f'<span>{_money(doc.taxable_subtotal())}</span></div>'
                f'<div class="row gstflag"><span>GST-FREE SUBTOTAL</span>'
                f'<span>{_money(doc.free_subtotal())}</span></div>'
            )

    abn = f'<div class="c">ABN {_e(doc.supplier_abn)}</div>' if doc.supplier_abn else ''
    ti = '<div class="c b" style="margin-top:8px">*** TAX INVOICE ***</div>' if doc.says_tax_invoice else ''
    op = f'<span>Op: {_e(doc.operator)}</span>' if doc.operator else '<span></span>'

    css = (_SCENE_CSS % {'pad': 46, 'rot': rot, 'tilt': 3.0}) + (_THERMAL_CSS % {'width': width})
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>{css}</style></head>
<body><div class="scene"><div class="paper">
  <div class="c b big">{_e(doc.supplier_name.upper())}</div>
  <div class="c">{_e(doc.address)}</div>
  {abn}
  {ti}
  <div class="rule"></div>
  <div class="row"><span>{_fmt_date(doc)}</span>{op}</div>
  <div class="row"><span>Inv {_e(doc.invoice_no)}</span><span></span></div>
  <div class="rule"></div>
  {''.join(rows)}
  <div class="rule"></div>
  <div class="row b big"><span>TOTAL</span><span>${_money(doc.total_inclusive())}</span></div>
  {gst_block}
  <div class="rule"></div>
  <div class="row"><span>{_e(doc.payment_method)}</span><span>{_money(doc.total_inclusive())}</span></div>
  <div class="c fade" style="margin-top:10px">THANK YOU</div>
</div></div></body></html>"""


def invoice_html(doc: SyntheticDoc, rot: float, width: int = 720) -> str:
    rows = ''.join(
        f'<tr><td>{_e(l.description)}</td><td class="r">{_money(l.amount)}</td></tr>'
        for l in doc.lines
    )
    gst = doc.gst_amount()
    gst_row = (
        f'<div class="row"><span>GST</span><span>{_money(gst)}</span></div>'
        if gst is not None else ''
    )
    abn = f'<div class="meta">ABN {_e(doc.supplier_abn)}</div>' if doc.supplier_abn else ''
    ti = '<div class="ti">TAX INVOICE</div>' if doc.says_tax_invoice else ''

    css = (_SCENE_CSS % {'pad': 54, 'rot': rot, 'tilt': 1.2}) + (_INVOICE_CSS % {'width': width})
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>{css}</style></head>
<body><div class="scene"><div class="paper">
  <div class="hdr">
    <div>
      <div class="name">{_e(doc.supplier_name)}</div>
      <div class="meta">{_e(doc.address)}</div>
      {abn}
    </div>
    <div>
      {ti}
      <div class="meta">Invoice {_e(doc.invoice_no)}</div>
      <div class="meta">Issued {_fmt_date(doc)}</div>
    </div>
  </div>
  <table>
    <thead><tr><th>Description</th><th class="r">Amount (AUD)</th></tr></thead>
    <tbody>{rows}</tbody>
  </table>
  <div class="totals">
    <div class="row"><span>Subtotal (incl.)</span><span>{_money(doc.total_inclusive())}</span></div>
    {gst_row}
    <div class="row grand"><span>Total due</span><span>${_money(doc.total_inclusive())}</span></div>
  </div>
</div></div></body></html>"""


THERMAL_ARCHETYPES = {'supermarket', 'fuel', 'cafe', 'no_abn_van'}


def html_for(doc: SyntheticDoc, rot: float) -> str:
    if doc.archetype in THERMAL_ARCHETYPES:
        return thermal_html(doc, rot)
    return invoice_html(doc, rot)


def render_many(jobs: list[tuple[SyntheticDoc, float, str]], scale: int = 2) -> None:
    """Render each (doc, rotation, out_path) with ONE browser for the whole batch.

    One browser, reused. Launching Chromium per document dominates the runtime
    of a 300-document generation and turns a two-minute build into half an hour.

    The viewport is sized per template so the captured frame is mostly document.
    A thermal docket is 300px of paper and does not belong in an 960px frame —
    see the note on _SCENE_CSS.
    """
    from playwright.sync_api import sync_playwright

    # Heights are deliberately SHORT. `full_page` captures max(viewport,
    # content), so a tall viewport pads a six-line docket with dead surface —
    # which is resolution a downscaling reader then spends on nothing.
    viewports = {True: {'width': 400, 'height': 260}, False: {'width': 840, 'height': 400}}

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport=viewports[True], device_scale_factor=scale)
        current_thermal = True
        for doc, rot, out_path in jobs:
            is_thermal = doc.archetype in THERMAL_ARCHETYPES
            if is_thermal != current_thermal:
                page.set_viewport_size(viewports[is_thermal])
                current_thermal = is_thermal
            page.set_content(html_for(doc, rot), wait_until='load')
            page.wait_for_timeout(15)
            os.makedirs(os.path.dirname(out_path), exist_ok=True)
            # full_page so a long invoice is captured in its entirety rather
            # than cropped at the viewport, which would silently delete line
            # items the truth still claims are present.
            page.screenshot(path=out_path, full_page=True)
        browser.close()
