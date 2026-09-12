"""OCR capability check against the shared Ollama Cloud provider.

Ground truth is known exactly, so this measures accuracy rather than
plausibility. The image is a rendered docket, photographed-ish: rotated,
perspective-skewed, with scan lines and a drop shadow. That is the EASY case —
a real crumpled thermal receipt in a dim cab is harder — so treat any score
here as an optimistic upper bound.
"""
import base64, json, os, sys, time
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(HERE, os.environ.get('OCR_IMG', 'receipt.png'))

TRUTH = {
    'supplier_name': 'BP Truckstop Gundagai',
    'supplier_abn': '33051775556',
    'issue_date': '2026-09-06',
    'total_inclusive': '266.91',
    'gst_amount': '24.26',
    'is_tax_invoice': True,
    'line_count': 3,
    'lines': [('DIESEL', '243.91'), ('ADBLUE', '18.50'), ('COFFEE', '4.50')],
}

PROMPT = """You are extracting structured data from an Australian receipt or tax invoice.

Return ONLY minified JSON, no prose, with exactly these keys:
{"supplier_name":string|null,"supplier_abn":string|null,"issue_date":"YYYY-MM-DD"|null,
"total_inclusive":string|null,"gst_amount":string|null,"is_tax_invoice":boolean,
"lines":[{"description":string,"amount":string}]}

Rules:
- supplier_abn: digits only, no spaces. null if not printed.
- Amounts: plain decimal strings, no currency symbol.
- is_tax_invoice: true only if the words "tax invoice" appear on the document.
- If a field is not legible, return null. NEVER guess a value."""


def key():
    path = r'C:\Users\Hansel\.claude\secrets\ollama-cloud.env'
    for line in open(path, encoding='utf-8'):
        line = line.strip()
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            if 'KEY' in k.upper() or 'TOKEN' in k.upper():
                return v.strip().strip('"').strip("'")
    raise SystemExit('no key')


def call(model, b64, timeout=180):
    body = json.dumps({
        'model': model,
        'messages': [{
            'role': 'user',
            'content': [
                {'type': 'text', 'text': PROMPT},
                {'type': 'image_url', 'image_url': {'url': f'data:image/png;base64,{b64}'}},
            ],
        }],
        'temperature': 0,
        'max_tokens': 3000,
    }).encode()
    req = urllib.request.Request(
        'https://ollama.com/v1/chat/completions',
        data=body,
        headers={'Authorization': f'Bearer {key()}', 'Content-Type': 'application/json'},
    )
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = json.load(r)
    return data, time.time() - t0


def parse(text):
    text = text.strip()
    if text.startswith('```'):
        text = text.split('```')[1]
        if text.startswith('json'):
            text = text[4:]
    start, end = text.find('{'), text.rfind('}')
    if start < 0 or end < 0:
        return None
    try:
        return json.loads(text[start:end + 1])
    except Exception:
        return None


def score(got):
    if not got:
        return 0, ['unparseable']
    hits, notes = 0, []
    checks = [
        ('supplier_name', lambda v: isinstance(v, str) and 'gundagai' in v.lower()),
        ('supplier_abn', lambda v: isinstance(v, str) and ''.join(c for c in v if c.isdigit()) == TRUTH['supplier_abn']),
        ('issue_date', lambda v: v == TRUTH['issue_date']),
        ('total_inclusive', lambda v: v is not None and abs(float(str(v).replace('$', '').replace(',', '')) - 266.91) < 0.005),
        ('gst_amount', lambda v: v is not None and abs(float(str(v).replace('$', '')) - 24.26) < 0.005),
        ('is_tax_invoice', lambda v: v is True),
    ]
    for field, ok in checks:
        try:
            good = ok(got.get(field))
        except Exception:
            good = False
        hits += 1 if good else 0
        if not good:
            notes.append(f'{field}={got.get(field)!r}')
    lines = got.get('lines') or []
    if len(lines) == TRUTH['line_count']:
        hits += 1
    else:
        notes.append(f'lines={len(lines)}')
    amounts = {str(l.get('amount', '')).replace('$', '') for l in lines if isinstance(l, dict)}
    if {'243.91', '18.50', '4.50'} <= amounts:
        hits += 1
    else:
        notes.append(f'line amounts={sorted(amounts)}')
    return hits, notes


if __name__ == '__main__':
    b64 = base64.b64encode(open(IMG, 'rb').read()).decode()
    print(f'image: {len(b64)*3//4//1024} KB\n')
    models = sys.argv[1:] or ['gemma4:31b', 'qwen3.5:397b', 'minimax-m3', 'glm-5.3']
    for m in models:
        try:
            data, secs = call(m, b64)
            text = data['choices'][0]['message']['content']
            got = parse(text)
            hits, notes = score(got)
            usage = data.get('usage', {})
            print(f'== {m}  {hits}/8 correct  {secs:.1f}s  tokens={usage.get("total_tokens","?")}')
            print(f'   {json.dumps(got, separators=(",", ":"))[:300] if got else text[:300]}')
            if notes:
                print(f'   WRONG: {"; ".join(notes)}')
        except Exception as e:
            print(f'== {m}  FAILED: {type(e).__name__}: {str(e)[:220]}')
        print()
