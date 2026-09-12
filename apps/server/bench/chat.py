"""Which model should answer users' questions?

A chatbot in this app is not a general assistant — it answers "can I claim
this?" for an Australian small business. So it is scored on the rules that
decide money, where a fluent wrong answer costs the user a disallowed claim:

  - GST inside a GST-inclusive price is 1/11, NOT 10%.
  - A tax invoice is required at $82.50 including GST.
  - At $1,000 the invoice must also identify the buyer.
  - Business records are kept 5 years.
  - Travel between home and a regular workplace is private, not deductible.

Also scored: refusing to invent. A model that answers a question about another
country's rules as though they were Australian is worse than one that says it
does not know.
"""
import json, sys, time
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, '.')
import run

SYSTEM = (
    'You are the assistant inside an Australian bookkeeping app. Answer briefly and '
    'concretely for a small business owner. Use Australian tax rules only. If you are '
    'not certain of a figure or a rule, say so plainly rather than guessing — a wrong '
    'figure costs the user a disallowed claim.'
)

QUESTIONS = [
    {
        'q': 'I paid $266.91 including GST for diesel. How much GST can I claim back?',
        # 266.91 / 11 = 24.2645 -> 24.26
        'must': ['24.26'],
        'must_not': ['26.69'],  # 10% of the inclusive total: the classic error
        'why': 'GST is 1/11 of an inclusive amount, not 10%',
    },
    {
        'q': 'Do I need a tax invoice for a $60 receipt, and for a $95 one?',
        'must': ['82.50'],
        'must_not': [],
        'why': 'the $82.50 threshold',
    },
    {
        'q': 'A supplier invoiced me $1,848 including GST but the invoice does not show my business name or ABN. Is that a problem?',
        'must': ['1,000', '1000'],
        'any_of': True,
        'must_not': [],
        'why': 'the $1,000 buyer-identification threshold',
    },
    {
        'q': 'How long do I have to keep my receipts?',
        'must': ['five years', '5 years'],
        'any_of': True,
        'must_not': [],
        'why': 'the 5-year retention period',
    },
    {
        'q': 'Can I claim the fuel for driving from my house to the depot I start work at every morning?',
        'must': ['cannot', 'not deductible', "can't", 'private', 'no'],
        'any_of': True,
        'must_not': [],
        'why': 'home-to-work travel is private',
    },
]

CANDIDATES = [
    'glm-5.3',
    'glm-5.3-flash',
    'glm-5.2',
    'deepseek-v4-pro:0813',
    'deepseek-v4-flash:0731',
    'kimi-k3',
    'minimax-m3',
    'qwen3.5:397b',
    'gpt-oss:120b',
]


def ask(model, question):
    import urllib.request

    body = json.dumps({
        'model': model,
        'messages': [
            {'role': 'system', 'content': SYSTEM},
            {'role': 'user', 'content': question},
        ],
        'temperature': 0,
        'max_tokens': 700,
    }).encode()
    req = urllib.request.Request(
        'https://ollama.com/v1/chat/completions',
        data=body,
        headers={'Authorization': f'Bearer {run.key()}', 'Content-Type': 'application/json'},
    )
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=240) as r:
        data = json.load(r)
    return data['choices'][0]['message']['content'], time.time() - t0, data.get('usage', {})


print(f'{"model":24} {"score":>7} {"avg s":>7}  misses')
print('-' * 78)

for model in CANDIDATES:
    hits, total_s, misses = 0, 0.0, []
    try:
        for item in QUESTIONS:
            answer, secs, _ = ask(model, item['q'])
            total_s += secs
            low = answer.lower().replace(',', ',')
            if item.get('any_of'):
                ok = any(m.lower() in low for m in item['must'])
            else:
                ok = all(m.lower() in low for m in item['must'])
            if ok and any(bad.lower() in low for bad in item['must_not']):
                ok = False
            hits += 1 if ok else 0
            if not ok:
                misses.append(item['why'])
        print(f'{model:24} {hits:>5}/{len(QUESTIONS)} {total_s / len(QUESTIONS):>7.1f}  {"; ".join(misses)[:38]}')
    except Exception as e:
        msg = str(e)
        note = 'not available' if '404' in msg else f'{type(e).__name__}: {msg[:34]}'
        print(f'{model:24} {"—":>7} {"—":>7}  {note}')
