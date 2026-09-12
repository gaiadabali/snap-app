"""Retried writes happen once.

The case this exists for: a phone at a truck stop sends a payment, the signal
drops before the response arrives, and the app cannot tell whether the server
completed the write. Retrying risks charging twice; not retrying risks losing
it. An Idempotency-Key makes the question answerable.

Every check here runs against a real database as the non-superuser role,
because what is being tested is a uniqueness claim enforced by a primary key.
"""
import json, sys, threading, time, urllib.error, urllib.request

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

API = 'http://127.0.0.1:4000'
BUSINESS = '11111111-1111-4111-8111-111111111111'
fails = []


def check(name, ok, detail=''):
    print(f'  {"PASS" if ok else "FAIL"}  {name}' + (f' — {detail}' if detail else ''))
    if not ok:
        fails.append(name)


def call(method, path, token=None, workspace=None, body=None, key=None):
    headers = {}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    if workspace:
        headers['X-Workspace-Id'] = workspace
    if key:
        headers['Idempotency-Key'] = key
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


stamp = str(int(time.time()))
_, signin = call('POST', '/v1/auth/sign-in', body={'email': 'kate@marshtransport.example'})
kate = signin['token']

print('\n1. Without a key, nothing changes')
a = call('POST', '/v1/trips', token=kate, workspace=BUSINESS,
         body={'date': '2026-09-10', 'fromPlace': 'A', 'toPlace': 'B', 'km': 10.0,
               'purpose': f'no-key {stamp}', 'workRelated': True, 'source': 'manual'})
b = call('POST', '/v1/trips', token=kate, workspace=BUSINESS,
         body={'date': '2026-09-10', 'fromPlace': 'A', 'toPlace': 'B', 'km': 10.0,
               'purpose': f'no-key {stamp}', 'workRelated': True, 'source': 'manual'})
check('two identical writes with no key create two rows',
      a[0] == 201 and b[0] == 201 and a[1]['id'] != b[1]['id'],
      'the interceptor is inert without the header, which is the point')
for created in (a[1]['id'], b[1]['id']):
    call('DELETE', f'/v1/trips/{created}', token=kate, workspace=BUSINESS)

print('\n2. With a key, a retry happens once')
key = f'trip-{stamp}'
trip = {'date': '2026-09-10', 'fromPlace': 'Goulburn', 'toPlace': 'Sydney', 'km': 196.4,
        'purpose': f'keyed {stamp}', 'workRelated': True, 'source': 'manual'}
first = call('POST', '/v1/trips', token=kate, workspace=BUSINESS, body=trip, key=key)
second = call('POST', '/v1/trips', token=kate, workspace=BUSINESS, body=trip, key=key)
check('the first write succeeds', first[0] == 201, f'HTTP {first[0]}')
check('the retry returns the SAME id, not a new row',
      second[1].get('id') == first[1].get('id'), f"{first[1].get('id')} vs {second[1].get('id')}")
check('and the same status code', second[0] == first[0], f'{first[0]} then {second[0]}')

_, trips = call('GET', '/v1/trips', token=kate, workspace=BUSINESS)
matching = [t for t in trips if t['purpose'] == f'keyed {stamp}']
check('exactly one row exists in the database', len(matching) == 1, f'{len(matching)} rows')

print('\n3. A key is a promise about ONE request')
changed = {**trip, 'km': 999.9}
status, body = call('POST', '/v1/trips', token=kate, workspace=BUSINESS, body=changed, key=key)
check('reusing the key with different content is refused, not silently replayed',
      status == 409, body.get('message', '')[:70])
_, trips = call('GET', '/v1/trips', token=kate, workspace=BUSINESS)
check('and nothing was written for it',
      len([t for t in trips if t['km'] == 999.9]) == 0)

# The method and path are part of a request's identity too, not just the body.
status, _ = call('DELETE', f"/v1/trips/{first[1]['id']}", token=kate, workspace=BUSINESS, key=key)
check('the same key on a different endpoint is refused', status == 409, f'HTTP {status}')

print('\n4. Two retries racing')
race_key = f'race-{stamp}'
race_trip = {'date': '2026-09-09', 'fromPlace': 'Depot', 'toPlace': 'Port', 'km': 42.0,
             'purpose': f'race {stamp}', 'workRelated': True, 'source': 'manual'}
results = []


def fire():
    results.append(call('POST', '/v1/trips', token=kate, workspace=BUSINESS,
                        body=race_trip, key=race_key))


threads = [threading.Thread(target=fire) for _ in range(4)]
for t in threads:
    t.start()
for t in threads:
    t.join()

codes = sorted(r[0] for r in results)
created = [r for r in results if r[0] == 201]
check('exactly one of four concurrent attempts creates the row',
      len(created) == 1, f'status codes {codes}')
check('the losers are told to retry rather than duplicating',
      all(r[0] in (201, 409) for r in results), f'status codes {codes}')

_, trips = call('GET', '/v1/trips', token=kate, workspace=BUSINESS)
racing = [t for t in trips if t['purpose'] == f'race {stamp}']
check('and the database holds exactly one', len(racing) == 1, f'{len(racing)} rows')

print('\n5. Keys are scoped to a workspace and a person')
HOUSEHOLD = '22222222-2222-4222-8222-222222222222'
status, _ = call('PUT', '/v1/budgets', token=kate, workspace=HOUSEHOLD,
                 body={'category': f'Keyed {stamp}', 'monthly': '100.00'}, key=key)
check('the same key in ANOTHER workspace is not a replay of the first',
      status == 200, f'HTTP {status} — keys are per-tenant, as the table is')

print('\n6. Cleaning up')
for t in racing + matching:
    call('DELETE', f"/v1/trips/{t['id']}", token=kate, workspace=BUSINESS)
print('  removed the trips this suite created')

print(f'\n{"ALL PASSED" if not fails else "FAILED: " + ", ".join(fails)}')
