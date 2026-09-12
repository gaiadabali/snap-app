"""Does a cheap model USE the tools, or answer from memory?

This is the load-bearing question for phase 1. The models scored at most 4/5 on
Australian tax rules unaided; the plan is to give them the facts as functions.
That only works if they actually call them — a model that ignores a tool and
answers confidently from memory is worse than no tool at all, because now the
wrong answer looks sanctioned.

Run against the exact questions each model previously got WRONG.
"""
import json, sys, time, urllib.request
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, '.')
import run

SYSTEM = (
    'You are the assistant inside an Australian bookkeeping app.\n\n'
    'You must NEVER state a dollar figure, a rate, a threshold or a rule from your own '
    'knowledge. Australian thresholds and rates are supplied as functions and only the '
    'functions are correct. Call them and report what they return.\n\n'
    'If a question involves money, GST, an invoice requirement, an ABN, a rate or record '
    'keeping, you MUST call a function before answering.'
)

# Trimmed to what the provider needs; mirrors TOOL_SCHEMAS in src/ai/tools.ts.
TOOLS = [
    {
        'type': 'function',
        'function': {
            'name': 'gst_on_purchase',
            'description': 'Call this for ANY question about how much GST is in an amount already paid, or claimable on a purchase. Never compute GST yourself.',
            'parameters': {
                'type': 'object',
                'properties': {
                    'inclusiveAmount': {'type': 'string'},
                    'gstFreeAmount': {'type': 'string'},
                },
                'required': ['inclusiveAmount'],
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'tax_invoice_requirements',
            'description': 'Call this whenever asked whether a tax invoice is needed, what it must show, or whether a receipt supports a GST claim. It knows the dollar thresholds; you do not.',
            'parameters': {
                'type': 'object',
                'properties': {'inclusiveAmount': {'type': 'string'}},
                'required': ['inclusiveAmount'],
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'retention_period',
            'description': 'Call this for how long records must be kept.',
            'parameters': {'type': 'object', 'properties': {}},
        },
    },
]

# What our deterministic tools return — the answers the model must end up with.
TOOL_RESULTS = {
    'gst_on_purchase': lambda a: {
        'gstAmount': '24.2645',
        'answer': 'The GST in $266.91 is $24.26. GST inside a GST-inclusive price is exactly one eleventh of it, not ten per cent.',
    },
    'tax_invoice_requirements': lambda a: {
        'taxInvoiceRequired': float(str(a.get('inclusiveAmount', '0')).replace(',', '')) >= 82.50,
        'buyerIdentificationRequired': float(str(a.get('inclusiveAmount', '0')).replace(',', '')) >= 1000,
        'taxInvoiceThreshold': '82.50',
        'buyerAbnThreshold': '1000.00',
    },
    'retention_period': lambda a: {'years': 5, 'answer': 'Five years.'},
}

CASES = [
    {
        'q': 'I paid $266.91 including GST for diesel. How much GST can I claim back?',
        'expect_tool': 'gst_on_purchase',
        'expect_in_answer': ['24.26'],
    },
    {
        'q': 'Do I need a tax invoice for a $60 receipt, and for a $95 one?',
        'expect_tool': 'tax_invoice_requirements',
        'expect_in_answer': ['82.50'],
    },
    {
        'q': 'A supplier invoiced me $1,848 including GST but it does not show my business name or ABN. Is that a problem?',
        'expect_tool': 'tax_invoice_requirements',
        'expect_in_answer': ['1,000', '1000'],
    },
    {
        'q': 'How long do I have to keep my receipts?',
        'expect_tool': 'retention_period',
        'expect_in_answer': ['five year', '5 year'],
    },
]

CANDIDATES = ['glm-5.3', 'glm-5.3-flash', 'deepseek-v4-flash:0731', 'minimax-m3', 'kimi-k3']


def post(payload):
    req = urllib.request.Request(
        'https://ollama.com/v1/chat/completions',
        data=json.dumps(payload).encode(),
        headers={'Authorization': f'Bearer {run.key()}', 'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(req, timeout=240) as r:
        return json.load(r)


def converse(model, question):
    """One round of tool calling, then the final answer."""
    messages = [
        {'role': 'system', 'content': SYSTEM},
        {'role': 'user', 'content': question},
    ]
    first = post({
        'model': model,
        'messages': messages,
        'tools': TOOLS,
        'temperature': 0,
        'max_tokens': 1200,
    })
    choice = first['choices'][0]['message']
    calls = choice.get('tool_calls') or []
    if not calls:
        return None, choice.get('content') or ''

    messages.append(choice)
    used = []
    for call in calls:
        name = call['function']['name']
        used.append(name)
        try:
            args = json.loads(call['function'].get('arguments') or '{}')
        except Exception:
            args = {}
        result = TOOL_RESULTS.get(name, lambda a: {'error': 'unknown tool'})(args)
        messages.append({
            'role': 'tool',
            'tool_call_id': call.get('id', name),
            'content': json.dumps(result),
        })

    second = post({
        'model': model,
        'messages': messages,
        'tools': TOOLS,
        'temperature': 0,
        'max_tokens': 1200,
    })
    return used, second['choices'][0]['message'].get('content') or ''


print(f'{"model":24} {"called":>7} {"correct":>8}  failures')
print('-' * 76)

for model in CANDIDATES:
    called, correct, failures = 0, 0, []
    try:
        for case in CASES:
            used, answer = converse(model, case['q'])
            low = (answer or '').lower()
            if used and case['expect_tool'] in used:
                called += 1
            elif used:
                failures.append(f"called {','.join(used)}")
            else:
                failures.append('answered from memory')
            if any(want.lower() in low for want in case['expect_in_answer']):
                correct += 1
            elif used:
                failures.append('tool result not reflected')
        print(f'{model:24} {called:>5}/{len(CASES)} {correct:>6}/{len(CASES)}  {"; ".join(failures)[:32]}')
    except Exception as e:
        msg = str(e)
        note = 'no tool support' if '400' in msg else f'{type(e).__name__}: {msg[:32]}'
        print(f'{model:24} {"—":>7} {"—":>8}  {note}')
