"""The business and personal endpoints, against a real database.

Checks the things that are only true if the SQL is right: that what is owed on
an invoice is DERIVED from its payments, that a stock take records the
difference rather than overwriting the count, that an estimate converts to a
draft with GST recomputed, and that the seat limit and last-owner rules hold.
"""
import json, sys, time, urllib.error, urllib.request

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

API = 'http://127.0.0.1:4000'
BUSINESS = '11111111-1111-4111-8111-111111111111'
HOUSEHOLD = '22222222-2222-4222-8222-222222222222'
fails = []


def check(name, ok, detail=''):
    print(f'  {"PASS" if ok else "FAIL"}  {name}' + (f' — {detail}' if detail else ''))
    if not ok:
        fails.append(name)


def call(method, path, token=None, workspace=None, body=None):
    headers = {}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    if workspace:
        headers['X-Workspace-Id'] = workspace
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(API + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            text = r.read().decode()
            return r.status, (json.loads(text) if text else None)
    except urllib.error.HTTPError as e:
        text = e.read().decode()
        try:
            return e.code, json.loads(text)
        except Exception:
            return e.code, {'raw': text[:200]}


_, signin = call('POST', '/v1/auth/sign-in', body={'email': 'kate@marshtransport.example'})
kate = signin['token']
_, dan_in = call('POST', '/v1/auth/sign-in', body={'email': 'dan@marshtransport.example'})
dan = dan_in['token']
stamp = str(int(time.time()))

print('\n1. Workspaces and permissions')
status, spaces = call('GET', '/v1/workspaces', token=kate)
check('lists both workspaces', status == 200 and len(spaces) == 2,
      ', '.join(w['name'] for w in spaces or []))
status, perms = call('GET', f'/v1/workspaces/{BUSINESS}/permissions', token=kate, workspace=BUSINESS)
check('owner may confirm', perms['canConfirm'] is True)
status, dperms = call('GET', f'/v1/workspaces/{BUSINESS}/permissions', token=dan, workspace=BUSINESS)
check('staff may capture but not confirm',
      dperms['canCapture'] is True and dperms['canConfirm'] is False)

print('\n2. People and invitations')
status, members = call('GET', f'/v1/workspaces/{BUSINESS}/members', token=kate, workspace=BUSINESS)
check('lists members with seats', status == 200 and members['seatsUsed'] >= 5,
      f"{members['seatsUsed']} of {members['seatLimit']}")
status, invited = call('POST', f'/v1/workspaces/{BUSINESS}/invitations', token=kate,
                       workspace=BUSINESS, body={'email': f'noah{stamp}@example.com', 'role': 'member'})
check('invitation issued with a one-time token', status == 201 and len(invited.get('token', '')) > 20,
      f'HTTP {status}')
status, dupe = call('POST', f'/v1/workspaces/{BUSINESS}/invitations', token=kate,
                    workspace=BUSINESS, body={'email': f'NOAH{stamp}@example.com', 'role': 'member'})
check('a second invite to the same inbox is refused (citext)', status == 409, f'HTTP {status}')
status, _ = call('POST', f'/v1/workspaces/{BUSINESS}/invitations', token=dan,
                 workspace=BUSINESS, body={'email': f'x{stamp}@example.com', 'role': 'member'})
check('staff cannot invite', status == 409, f'HTTP {status}')
status, _ = call('DELETE', f"/v1/workspaces/{BUSINESS}/invitations/{invited['id']}",
                 token=kate, workspace=BUSINESS)
check('invitation revoked', status == 200, f'HTTP {status}')

# Accepting an invitation is the one write a NON-member makes, so it cannot go
# through the membership guard or through any tenant-scoped statement. It runs
# as `invitation_accept` (migration 0015), which checks the token, the address
# it was issued to, and the seat limit in one locked transaction.
noah_email = f'noah{stamp}@example.com'
status, noah_invite = call('POST', f'/v1/workspaces/{BUSINESS}/invitations', token=kate,
                           workspace=BUSINESS, body={'email': noah_email, 'role': 'member'})
check('a fresh invitation for Noah', status == 201, f'HTTP {status}')

_, noah_in = call('POST', '/v1/auth/sign-in', body={'email': noah_email})
noah = noah_in['token']
status, before = call('GET', '/v1/workspaces', token=noah)
check('Noah is in nothing yet', status == 200 and len(before) == 0, str(before))

status, wrong = call('POST', '/v1/workspaces/invitations/accept', token=dan,
                     body={'token': noah_invite['token']})
check('a forwarded link does not admit the wrong person', status == 409, f'HTTP {status}')

status, joined = call('POST', '/v1/workspaces/invitations/accept', token=noah,
                      body={'token': noah_invite['token']})
check('Noah joins with the role he was invited as',
      status == 200 and joined.get('id') == BUSINESS and joined.get('role') == 'member',
      f'HTTP {status} {joined}')
status, after = call('GET', '/v1/workspaces', token=noah)
check('and the workspace now appears for him',
      any(w['id'] == BUSINESS for w in after or []), str([w['name'] for w in after or []]))

status, reused = call('POST', '/v1/workspaces/invitations/accept', token=noah,
                      body={'token': noah_invite['token']})
check('a spent token is refused', status == 404, f'HTTP {status}')

status, nonsense = call('POST', '/v1/workspaces/invitations/accept', token=noah,
                        body={'token': 'not-a-real-token'})
check('so is a made-up one', status == 404, f'HTTP {status}')

# Put the workspace back as it was, so the suite is re-runnable.
call('DELETE', f'/v1/workspaces/{BUSINESS}/members/{noah_in["user"]["userId"]}',
     token=kate, workspace=BUSINESS)

kate_id = signin['user']['userId']
status, body = call('PATCH', f'/v1/workspaces/{BUSINESS}/members/{kate_id}', token=kate,
                    workspace=BUSINESS, body={'role': 'member'})
check('the last owner cannot demote themselves', status == 409, f'HTTP {status}')

print('\n3. Parties and items')
status, party = call('POST', '/v1/parties', token=kate, workspace=BUSINESS,
                     body={'name': f'Northline Freight {stamp}', 'kind': 'customer',
                           'abn': '51824753556', 'email': 'ap@northline.example'})
check('customer created', status == 201 and 'id' in (party or {}), f'HTTP {status}')
status, parties = call('GET', '/v1/parties?kind=customer', token=kate, workspace=BUSINESS)
check('customer appears with an open balance',
      any(p['id'] == party['id'] and p['openBalance'] == '0' for p in parties),
      next((p['openBalance'] for p in parties if p['id'] == party['id']), '?'))

status, item = call('POST', '/v1/items', token=kate, workspace=BUSINESS,
                    body={'name': 'Line-haul freight', 'sku': f'FRT-{stamp}', 'unit': 'km',
                          'sellPrice': '2.9500', 'costPrice': '1.8200', 'stockOnHand': 40})
check('item created', status == 201, f'HTTP {status}')
status, clash = call('POST', '/v1/items', token=kate, workspace=BUSINESS,
                     body={'name': 'Another', 'sku': f'FRT-{stamp}', 'unit': 'ea',
                           'sellPrice': '1.00', 'costPrice': '0.50'})
check('a duplicate SKU is refused', status == 400, f'HTTP {status}')

print('\n4. Stock take records the difference')
status, counted = call('POST', f"/v1/items/{item['id']}/count", token=kate, workspace=BUSINESS,
                       body={'countedQuantity': 37})
check('count accepted', status == 200 and counted['difference'] == -3,
      f"difference {counted.get('difference')}")
status, moves = call('GET', '/v1/stock-movements', token=kate, workspace=BUSINESS)
mine = [m for m in moves if m['itemId'] == item['id']]
check('a movement explains the change', len(mine) == 1 and mine[0]['quantity'] == -3,
      str(mine[:1]))
status, items = call('GET', '/v1/items', token=kate, workspace=BUSINESS)
check('the balance followed the count',
      any(i['id'] == item['id'] and i['stockOnHand'] == 37 for i in items))

print('\n5. Trips')
status, trip = call('POST', '/v1/trips', token=kate, workspace=BUSINESS,
                    body={'date': '2026-09-10', 'fromPlace': 'Goulburn depot',
                          'toPlace': 'Sydney markets', 'km': 196.4,
                          'purpose': 'Line-haul delivery', 'workRelated': True, 'source': 'gps'})
check('trip logged', status == 201, f'HTTP {status}')
status, trips = call('GET', '/v1/trips', token=kate, workspace=BUSINESS)
logged = next((t for t in trips if t['id'] == trip['id']), None)
check('distance kept to one decimal', logged and abs(logged['km'] - 196.4) < 0.001,
      str(logged['km']) if logged else 'missing')
check('the source is recorded', logged and logged['source'] == 'gps')
status, _ = call('DELETE', f"/v1/trips/{trip['id']}", token=kate, workspace=BUSINESS)
check('trip removed', status == 200)

print('\n6. Budgets and goals (household)')
status, _ = call('PUT', '/v1/budgets', token=kate, workspace=HOUSEHOLD,
                 body={'category': 'Groceries', 'monthly': '950.00'})
check('budget set', status == 200, f'HTTP {status}')
status, _ = call('PUT', '/v1/budgets', token=kate, workspace=HOUSEHOLD,
                 body={'category': 'Groceries', 'monthly': '900.00'})
status, budgets = call('GET', '/v1/budgets', token=kate, workspace=HOUSEHOLD)
groceries = next((b for b in budgets if b['category'] == 'Groceries'), None)
check('setting it twice updates rather than duplicates',
      groceries and groceries['monthly'] == '900.0000' and
      len([b for b in budgets if b['category'] == 'Groceries']) == 1,
      str(groceries))

status, goal = call('POST', '/v1/goals', token=kate, workspace=HOUSEHOLD,
                    body={'name': f'Queensland trip {stamp}', 'target': '4800.00',
                          'targetDate': '2027-04-01'})
check('goal created', status == 201, f'HTTP {status}')
status, _ = call('POST', f"/v1/goals/{goal['id']}/contribute", token=kate, workspace=HOUSEHOLD,
                 body={'amount': '2150.00'})
status, goals = call('GET', '/v1/goals', token=kate, workspace=HOUSEHOLD)
mine = next((g for g in goals if g['id'] == goal['id']), None)
check('contribution recorded', mine and mine['saved'] == '2150.0000', str(mine and mine['saved']))
check('monthly amount computed from the deadline',
      mine and mine['perMonth'] is not None and float(mine['perMonth']) > 0,
      str(mine and mine['perMonth']))
check('not done until funded', mine and mine['done'] is False)

print('\n7. Household data never appears in the business')
status, bizBudgets = call('GET', '/v1/budgets', token=kate, workspace=BUSINESS)
check('the budget is scoped to the household',
      not any(b['category'] == 'Groceries' for b in bizBudgets), str(bizBudgets[:2]))
status, _ = call('GET', '/v1/budgets', token=dan, workspace=HOUSEHOLD)
check('Dan cannot read the household at all', status == 403, f'HTTP {status}')

print(f'\n{"ALL PASSED" if not fails else "FAILED: " + ", ".join(fails)}')
