"""Generate the bench corpus assets that are NOT already committed.

Two existing images (receipt.png, receipt-hard.png) are left untouched —
other scripts (run.py, hard.py, e2e.py) depend on those exact paths.

This script only produces the NEW assets `manifest.json` points at:

  - corpus/receipt-noabn.png   — rendered from noabn.html (abstention case:
    no ABN printed, not a tax invoice, no GST line — the model must return
    null/false rather than invent a value).
  - corpus/invoice-multipage.pdf — a synthetic, digitally-native two-page AU
    tax invoice, plus one rasterised PNG per page (corpus/invoice-multipage-p1.png,
    -p2.png) for engines that only accept images. The grand total and GST
    only appear on page 2, so a model that stops reading after page 1 will
    fail those fields — that is the point of including it.

Re-run whenever the HTML sources change:
    python gen_corpus.py
"""
import os
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
CORPUS = os.path.join(HERE, 'corpus')
os.makedirs(CORPUS, exist_ok=True)

# ---------------------------------------------------------------------------
# 1. receipt-noabn.png — screenshot of noabn.html, same "photographed" style
#    as receipt.png/receipt-hard.png (rotated paper on a dark background).
# ---------------------------------------------------------------------------


def render_noabn():
    src = os.path.join(HERE, 'noabn.html')
    out = os.path.join(CORPUS, 'receipt-noabn.png')
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={'width': 480, 'height': 820}, device_scale_factor=2)
        page.goto(f'file:///{src}')
        page.wait_for_timeout(50)
        page.screenshot(path=out)
        browser.close()
    print('wrote', out)


# ---------------------------------------------------------------------------
# 2. invoice-multipage.{html,pdf} — a digitally-generated 2-page AU tax
#    invoice. Line items fill page 1; the subtotal/GST/grand total, plus the
#    last few line items, land on page 2 through normal document flow (no
#    manual page-break hacks) so the pagination is exactly what a real
#    invoicing system would produce.
# ---------------------------------------------------------------------------

SUPPLIER = 'Southern Cross Logistics Pty Ltd'
# The ABN's 2 leading digits are check digits, not free text — derive them
# from the 9-digit business number rather than typing an 11-digit number
# that merely looks plausible. An early version of this file hand-typed
# 54129887341, which fails the mod-89 checksum in
# apps/server/src/extraction/validators.ts::abnIsValid; that made the corpus
# unable to prove anything about the ABN-misread defence, since a correct and
# an incorrect reading both fail the same (invalid) ground truth. See abn.py.
from abn import derive_valid_abn, abn_is_valid

_ABN_BUSINESS9 = '129887341'
ABN_DIGITS = derive_valid_abn(_ABN_BUSINESS9)
assert abn_is_valid(ABN_DIGITS), f'derive_valid_abn produced an invalid ABN: {ABN_DIGITS}'
ABN = ' '.join([ABN_DIGITS[0:2], ABN_DIGITS[2:5], ABN_DIGITS[5:8], ABN_DIGITS[8:11]])
ISSUE_DATE = '2026-08-14'
INVOICE_NO = 'INV-20264471'

# 24 freight line items. Amounts are fixed and hand-summed below so ground
# truth in manifest.json is exact, not derived at render time.
LINES = [
    ('Freight: Melbourne -> Sydney (14/08)', 640.00),
    ('Freight: Sydney -> Brisbane (14/08)', 715.50),
    ('Freight: Brisbane -> Cairns (14/08)', 980.00),
    ('Freight: Cairns -> Townsville (14/08)', 410.25),
    ('Freight: Townsville -> Darwin (14/08)', 1120.00),
    ('Freight: Darwin -> Alice Springs (14/08)', 890.75),
    ('Freight: Alice Springs -> Adelaide (14/08)', 960.00),
    ('Freight: Adelaide -> Perth (14/08)', 1340.50),
    ('Freight: Perth -> Kalgoorlie (14/08)', 505.00),
    ('Freight: Kalgoorlie -> Adelaide (14/08)', 960.00),
    ('Fuel levy — Melbourne run', 88.40),
    ('Fuel levy — Sydney run', 92.10),
    ('Fuel levy — Brisbane run', 104.60),
    ('Fuel levy — Cairns run', 61.30),
    ('Fuel levy — Darwin run', 130.25),
    ('Pallet hire (40 pallets)', 220.00),
    ('Pallet hire (18 pallets)', 99.00),
    ('Tail-lift surcharge', 75.00),
    ('After-hours delivery surcharge', 150.00),
    ('Waiting time — Brisbane depot (2.5h)', 187.50),
    ('Waiting time — Perth depot (1h)', 75.00),
    ('Insurance — high-value load', 240.00),
    ('Depot handling fee x3', 165.00),
    ('Interstate compliance fee', 130.00),
    ('Freight: Adelaide -> Melbourne (15/08)', 705.00),
    ('Freight: Melbourne -> Hobart (ferry) (15/08)', 1180.00),
    ('Freight: Hobart -> Launceston (15/08)', 340.00),
    ('Freight: Launceston -> Melbourne (ferry) (16/08)', 1180.00),
    ('Freight: Melbourne -> Geelong (16/08)', 210.00),
    ('Freight: Geelong -> Ballarat (16/08)', 260.00),
    ('Freight: Ballarat -> Bendigo (16/08)', 230.00),
    ('Freight: Bendigo -> Mildura (16/08)', 480.00),
    ('Fuel levy — Adelaide run', 76.50),
    ('Fuel levy — Tasmania run', 210.00),
    ('Fuel levy — regional Victoria run', 98.00),
    ('Pallet hire (24 pallets)', 132.00),
    ('Refrigeration surcharge — Tasmania run', 165.00),
    ('Ferry booking fee x2', 90.00),
    ('Weekend loading fee', 120.00),
    ('Depot handling fee x2', 110.00),
]
SUBTOTAL = round(sum(a for _, a in LINES), 2)          # 10,150.15... computed below
GST = round(SUBTOTAL / 10, 2)
TOTAL = round(SUBTOTAL + GST, 2)


def render_invoice():
    rows_html = '\n'.join(
        f'<tr><td>{i+1}</td><td>{desc}</td><td class="amt">{amt:,.2f}</td></tr>'
        for i, (desc, amt) in enumerate(LINES)
    )
    html = f"""<!doctype html><html><head><meta charset="utf-8"><style>
  @page {{ size: A4; margin: 18mm 16mm; }}
  body {{ font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #1a1a1a; }}
  h1 {{ font-size: 16px; margin: 0 0 2px; }}
  .sub {{ color: #444; margin: 0 0 12px; }}
  .meta {{ display:flex; justify-content:space-between; margin-bottom: 14px; }}
  table {{ width: 100%; border-collapse: collapse; }}
  th, td {{ text-align: left; padding: 4px 6px; border-bottom: 1px solid #ddd; }}
  th {{ background: #f0f0f0; }}
  td.amt, th.amt {{ text-align: right; }}
  tr {{ break-inside: avoid; }}
  .totals {{ margin-top: 10px; width: 260px; margin-left: auto; }}
  .totals .row {{ display:flex; justify-content:space-between; padding: 3px 6px; }}
  .totals .grand {{ font-weight: bold; border-top: 2px solid #1a1a1a; font-size: 13px; }}
  .stamp {{ font-weight:bold; letter-spacing: 1px; margin-bottom: 6px; }}
</style></head><body>
  <div class="stamp">*** TAX INVOICE ***</div>
  <h1>{SUPPLIER}</h1>
  <div class="sub">ABN {ABN} &middot; 4 Depot Rd, Laverton North VIC 3026</div>
  <div class="meta">
    <div>Invoice: {INVOICE_NO}<br>Date: 14 August 2026</div>
    <div>Bill to: Gaiada Transport Admin<br>Terms: 14 days</div>
  </div>
  <table>
    <thead><tr><th>#</th><th>Description</th><th class="amt">Amount (AUD)</th></tr></thead>
    <tbody>
{rows_html}
    </tbody>
  </table>
  <div class="totals">
    <div class="row"><span>Subtotal</span><span>{SUBTOTAL:,.2f}</span></div>
    <div class="row"><span>GST (10%)</span><span>{GST:,.2f}</span></div>
    <div class="row grand"><span>TOTAL</span><span>{TOTAL:,.2f}</span></div>
  </div>
</body></html>"""

    html_path = os.path.join(HERE, 'invoice-multipage.html')
    with open(html_path, 'w', encoding='utf-8') as f:
        f.write(html)

    pdf_path = os.path.join(CORPUS, 'invoice-multipage.pdf')
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(f'file:///{html_path}')
        page.pdf(path=pdf_path, format='A4', print_background=True,
                 margin={'top': '18mm', 'bottom': '18mm', 'left': '16mm', 'right': '16mm'})
        browser.close()
    print('wrote', html_path)
    print('wrote', pdf_path)
    print(f'computed: subtotal={SUBTOTAL:.2f} gst={GST:.2f} total={TOTAL:.2f}')

    # Rasterise each PDF page to PNG for engines that need images, not PDF bytes.
    import fitz  # pymupdf
    doc = fitz.open(pdf_path)
    n_pages = doc.page_count
    for i, pg in enumerate(doc):
        pix = pg.get_pixmap(matrix=fitz.Matrix(2, 2))  # 2x for legibility
        png_path = os.path.join(CORPUS, f'invoice-multipage-p{i+1}.png')
        pix.save(png_path)
        print('wrote', png_path)
    doc.close()
    if n_pages != 2:
        print(f'WARNING: expected 2 pages from document flow, got {n_pages}. '
              f'Update manifest.json page_count and re-check pagination.')
    return n_pages


if __name__ == '__main__':
    render_noabn()
    n_pages = render_invoice()
    print()
    print('Ground truth to sanity-check against manifest.json:')
    print(f'  ABN digits   = {ABN_DIGITS}')
    print(f'  subtotal     = {SUBTOTAL:.2f}')
    print(f'  gst          = {GST:.2f}')
    print(f'  total        = {TOTAL:.2f}')
    print(f'  line_count   = {len(LINES)}')
    print(f'  page_count   = {n_pages}')
