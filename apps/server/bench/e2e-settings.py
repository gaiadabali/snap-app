"""Onboarding, settings, categories, the plan, connections and the tax pack.

The parts of the app that decide what a user is ALLOWED to do and what their
numbers mean. Driven end to end against a real database as the non-superuser
role, because most of what is checked here is a database rule rather than a
code path: that a household cannot acquire an ABN, that a category is retired
rather than deleted, that an unmetered plan reports null rather than a number.
"""
import json, sys, time, urllib.error, urllib.request

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

API = 'http://127.0.0.1:4000'
BUSINESS = '11111111-1111-4111-8111-111111111111'
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


stamp = str(int(time.time()))
_, kate_in = call('POST', '/v1/auth/sign-in', body={'email': 'kate@marshtransport.example'})
kate = kate_in['token']

print('\n1. Onboarding a brand-new account')
_, new_in = call('POST', '/v1/auth/sign-in', body={'email': f'ravi{stamp}@example.com'})
ravi = new_in['token']
check('a new account belongs nowhere', len(new_in['workspaces']) == 0, str(new_in['workspaces']))

status, bad = call('POST', '/v1/workspaces/onboarding', token=ravi,
                   body={'workspaceName': 'Ravi Household', 'kind': 'personal',
                         'abn': '51824753556'})
check('a household cannot have an ABN', status == 400, f'HTTP {status}')

status, badabn = call('POST', '/v1/workspaces/onboarding', token=ravi,
                      body={'workspaceName': 'Ravi Freight', 'kind': 'business',
                            'abn': '51824753557'})
check('an ABN that fails the checksum is refused', status == 400,
      badabn.get('message', '')[:60])

status, done = call('POST', '/v1/workspaces/onboarding', token=ravi,
                    body={'workspaceName': 'Ravi Freight', 'kind': 'business',
                          'abn': '51 824 753 556', 'gstRegistered': True,
                          'gstBasis': 'cash', 'occupationProfileId': 'truckie_long'})
check('onboarding succeeds and returns the session', status == 200 and len(done['workspaces']) == 1,
      f'HTTP {status}')
ws = done['workspaceId']

status, settings = call('GET', '/v1/settings/business', token=ravi, workspace=ws)
check('the ABN was stored with the spaces stripped', settings['abn'] == '51824753556',
      str(settings['abn']))
check('and checksummed by the database', settings['abnValid'] is True)
check('the occupation came through', settings['occupationProfileId'] == 'truckie_long'
      and settings['occupationLabel'] is not None, str(settings['occupationLabel']))
check('GST registration came through', settings['gstRegistered'] is True)

status, cats = call('GET', '/v1/settings/categories', token=ravi, workspace=ws)
check('a new business starts with categories to use', status == 200 and len(cats) >= 10,
      f'{len(cats or [])} categories')
check('they carry ATO deduction labels',
      any(c['taxLabel'] == 'D1' for c in cats),
      str(sorted({c['taxLabel'] for c in cats if c['taxLabel']})))

print('\n2. A household gets a different list')
status, home = call('POST', '/v1/workspaces/onboarding', token=ravi,
                    body={'workspaceName': f'Ravi Household {stamp}', 'kind': 'personal',
                          'monthlyBudget': '2400.00'})
check('a personal workspace is created', status == 200, f'HTTP {status}')
home_id = home['workspaceId']
status, hcats = call('GET', '/v1/settings/categories', token=ravi, workspace=home_id)
check('a household is never offered a deduction label',
      all(c['taxLabel'] is None for c in hcats), str([c['taxLabel'] for c in hcats][:4]))
check('it starts with household categories',
      any(c['name'] == 'Groceries' for c in hcats), str([c['name'] for c in hcats][:4]))
status, personal = call('GET', '/v1/personal', token=ravi, workspace=home_id)
check('the budget given at onboarding is already in the tracker',
      personal['budgetTotal'] == '2400.0000', str(personal['budgetTotal']))

print('\n3. Categories are retired, never deleted')
status, after = call('PATCH', '/v1/settings/categories/Fuel', token=ravi,
                     workspace=ws, body={'active': False})
fuel = next((c for c in after if c['name'] == 'Fuel'), None)
check('retiring a category keeps it', status == 200 and fuel is not None and fuel['active'] is False,
      str(fuel))
status, after = call('PATCH', '/v1/settings/categories/Fuel', token=ravi,
                     workspace=ws, body={'active': True})
check('and it can be brought back',
      next((c for c in after if c['name'] == 'Fuel'), {}).get('active') is True)
status, _ = call('PATCH', '/v1/settings/categories/Nonexistent', token=ravi,
                 workspace=ws, body={'active': False})
check('an unknown category is a 404, not a silent no-op', status == 404, f'HTTP {status}')

status, added = call('POST', '/v1/settings/categories', token=ravi, workspace=ws,
                     body={'name': f'Ferry crossings {stamp}', 'taxLabel': 'D2'})
check('a category can be added', status == 200
      and any(c['name'] == f'Ferry crossings {stamp}' for c in added), f'HTTP {status}')

print('\n4. Settings refuse what the tax rules refuse')
status, msg = call('PATCH', '/v1/settings/business', token=ravi, workspace=home_id,
                   body={'abn': '51824753556'})
check('a household still cannot acquire an ABN later', status == 400,
      msg.get('message', '')[:50])
status, msg = call('PATCH', '/v1/settings/business', token=ravi, workspace=home_id,
                   body={'gstRegistered': True})
check('nor register for GST', status == 400, msg.get('message', '')[:50])
status, msg = call('PATCH', '/v1/settings/business', token=ravi, workspace=ws,
                   body={'occupationProfileId': 'astronaut'})
check('an unknown occupation is refused', status == 400, f'HTTP {status}')
status, cleared = call('PATCH', '/v1/settings/business', token=ravi, workspace=ws,
                       body={'abn': ''})
check('an ABN can be cleared', status == 200 and cleared['abn'] is None, str(cleared['abn']))
status, restored = call('PATCH', '/v1/settings/business', token=ravi, workspace=ws,
                        body={'abn': '51824753556', 'gstBasis': 'accrual'})
check('and put back', restored['abn'] == '51824753556' and restored['gstBasis'] == 'accrual')

print('\n5. Plan and seats')
status, plan = call('GET', '/v1/plan', token=kate, workspace=BUSINESS)
check('the plan is reported', status == 200 and plan['seatLimit'] >= 1,
      f"{plan['planName']}: {plan['seatsUsed']} of {plan['seatLimit']} seats")
check('an unmetered plan reports null rather than a number',
      (plan['scanQuota'] is None) == (plan['scansRemaining'] is None),
      f"quota {plan['scanQuota']} remaining {plan['scansRemaining']}")
check('the period end is a date', len(plan['periodEnds']) == 10, plan['periodEnds'])
status, solo = call('GET', '/v1/plan', token=ravi, workspace=ws)
check('a workspace with no subscription still gets an answer',
      status == 200 and solo['seatLimit'] == 1 and solo['seatsUsed'] == 1,
      f"{solo['planCode']}: {solo['seatsUsed']} of {solo['seatLimit']}")

print('\n6. Connections')
status, conns = call('GET', '/v1/connections', token=kate, workspace=BUSINESS)
check('all three providers are offered', status == 200 and len(conns) == 3,
      ', '.join(c['id'] for c in conns or []))
check('none is connected, and none claims a queue',
      all(c['status'] == 'disconnected' and c['queued'] == 0 for c in conns))

print('\n7. The tax pack')
status, pack = call('GET', '/v1/tax-pack', token=kate, workspace=BUSINESS)
check('a pack is described', status == 200 and len(pack['sections']) == 3, f'HTTP {status}')
check('it covers an Australian financial year, not a calendar one',
      pack['fromDate'].endswith('-07-01') and pack['toDate'].endswith('-06-30'),
      f"{pack['fromDate']} to {pack['toDate']}")
check('the byte total is the sum of its sections',
      pack['totalBytes'] == sum(s['bytes'] for s in pack['sections']),
      str(pack['totalBytes']))
check('an empty section is not marked for inclusion',
      all(s['included'] == (s['count'] > 0) for s in pack['sections']),
      str([(s['label'], s['count'], s['included']) for s in pack['sections']]))
check('retention is stated', '5 years' in pack['retentionNote'] or 'five years' in pack['retentionNote'])

print('\n7b. Assembling a real pack')
status, made = call('POST', '/v1/tax-pack', token=kate, workspace=BUSINESS)
check('the pack is assembled', status == 200 and made['bytes'] > 0,
      f"{made.get('documentCount')} documents, {made.get('bytes')} bytes")
check('it is named for the workspace and the year',
      made['filename'].endswith('.zip') and 'FY' in made['filename'], made['filename'])
check('the link expires', 'expiresAt' in made and made['url'].startswith('/v1/downloads/'))

# Downloaded with NO credentials at all — the signed token in the path is the
# whole credential, because the recipient is a browser.
with urllib.request.urlopen(urllib.request.Request(API + made['url']), timeout=60) as r:
    body = r.read()
    ok = r.status == 200
check('it downloads with no Authorization header', ok and len(body) == made['bytes'],
      f'{len(body)} bytes')
check('and it is a real ZIP', body[:4] == b'PK\x03\x04', str(body[:4]))
check('ending in a central directory', body[-22:-18] == b'PK\x05\x06')

# Every PAGE of every document, not just the first.
#
# `captures.original_storage_key` holds page 1 only, so reading it alone
# exported a two-page tax invoice as one image while the index claimed the
# document was complete — the same defect Phase 0 removes from capture,
# reappearing at the far end of the pipeline, on the record the ATO is shown.
import io as _io, zipfile as _zip
archive = _zip.ZipFile(_io.BytesIO(body))
names = archive.namelist()
index_rows = [r for r in archive.read('index.csv').decode().strip().splitlines()[1:] if r]
header = archive.read('index.csv').decode().splitlines()[0]
check('the index states a page count per document', 'pages' in header, header[:80])

multi = [r for r in index_rows if len(r.split(',')) > 8 and r.split(',')[7].isdigit()
         and int(r.split(',')[7]) > 1]
check('the corpus contains a multi-page document to prove this with',
      len(multi) > 0, f'{len(multi)} of {len(index_rows)} documents have >1 page')
if multi:
    declared = sum(int(r.split(',')[7]) for r in multi)
    folders = {n.rsplit('/', 1)[0] for n in names if '/page-' in n}
    exported = len([n for n in names if '/page-' in n])
    check('every declared page is in the archive', exported >= declared,
          f'{exported} page files for {declared} declared pages')
    check('each multi-page document has its own folder',
          len(folders) == len(multi), f'{len(folders)} folders for {len(multi)} documents')
    # Two different invoices sharing a folder would read as one document.
    check('no two documents are interleaved in one folder',
          all(len({n.rsplit('/', 1)[1] for n in names if n.startswith(f + '/')})
              == len([n for n in names if n.startswith(f + '/')]) for f in folders))
# The property that matters: the index ACCOUNTS FOR the archive. Every stored
# file is named by exactly one row, and every row names files that exist. An
# index that misses a file understates the record; one that names a file which
# is not there overstates it, and on a five-year record both are defects.
# The three metadata files are described by the README, not by the index.
stored = {n for n in names if n not in ('index.csv', 'README.txt', 'trip-log.csv')}
referenced = set()
for r in index_rows:
    cell = r.rsplit(',', 1)[-1]
    for part in cell.split(' | '):
        part = part.split(' (')[0].strip().strip('"')
        if part and part not in ('ALL PAGES MISSING',):
            referenced.add(part)
check('every stored file is named by the index', stored <= referenced,
      f'{len(stored - referenced)} unreferenced: {sorted(stored - referenced)[:2]}')
check('the index never names a file that is not there', referenced <= stored,
      f'{len(referenced - stored)} phantom: {sorted(referenced - stored)[:2]}')
check('the README explains the folder layout',
      'page-01' in archive.read('README.txt').decode())

status, _ = call('GET', '/v1/downloads/not-a-real-token')
check('a forged link is refused', status == 404, f'HTTP {status}')

print('\n7c. Connections are begun honestly')
status, err = call('POST', '/v1/connections/xero/connect', token=kate, workspace=BUSINESS)
check('connecting refuses when the server has no client id, rather than faking it',
      status == 400 and 'CLIENT_ID' in err.get('message', ''), err.get('message', '')[:70])
status, _ = call('POST', '/v1/connections/nonsuch/connect', token=kate, workspace=BUSINESS)
check('an unknown provider is a 404', status == 404, f'HTTP {status}')
status, after = call('POST', '/v1/connections/xero/disconnect', token=kate, workspace=BUSINESS)
check('disconnecting an unconnected provider is harmless',
      status == 200 and all(c['status'] == 'disconnected' for c in after), f'HTTP {status}')

print('\n7d. Demo accounts')
status, accounts = call('GET', '/v1/auth/demo-accounts')
check('the seeded accounts are listed', status == 200 and len(accounts) == 5,
      f'{len(accounts or [])} accounts')
check('each has an address to sign in with', all('@' in a['email'] for a in accounts))


print('\n8. Occupations are served, not shipped')
status, occs = call('GET', '/v1/settings/occupations', token=ravi, workspace=ws)
check('the occupation list is offered', status == 200 and len(occs) > 0,
      f'{len(occs or [])} groups')
check('every listed profile actually exists',
      all(p['label'] for g in occs for p in g['profiles']))

print('\n9. Isolation holds across all of it')
status, _ = call('GET', '/v1/settings/business', token=ravi, workspace=BUSINESS)
check('Ravi cannot read the Marsh workspace settings', status == 403, f'HTTP {status}')
status, _ = call('GET', '/v1/plan', token=ravi, workspace=BUSINESS)
check('nor its plan', status == 403, f'HTTP {status}')
status, mine = call('GET', '/v1/settings/categories', token=kate, workspace=BUSINESS)
check("nor do Ravi's categories appear in Kate's workspace",
      not any(c['name'].startswith('Ferry crossings') for c in mine),
      f'{len(mine or [])} categories')

print(f'\n{"ALL PASSED" if not fails else "FAILED: " + ", ".join(fails)}')
