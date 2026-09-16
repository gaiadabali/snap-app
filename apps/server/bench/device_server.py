"""Serve the corpus to a handset and collect the DocDOMs it reads back.

`docs/ON-DEVICE.md` §6.4 step 2: the gold-set images are recognised ON the
device by a developer screen that "runs `snap-ocr` over a folder of images and
exports one DocDOM per document", and those DocDOMs are committed under
`bench/corpus/device/<engine>/<device>/` like any other engine output.

WHY OVER HTTP RATHER THAN A FOLDER. Pushing 300 images onto the phone runs into
scoped storage on Android 11+, and pulling the results back out runs into it
again. `adb reverse tcp:8099 tcp:8099` makes THIS server reachable from the
handset at 127.0.0.1:8099 over the USB cable, so the phone needs no storage
permission, no network, and no files of its own. Start this, run the screen,
and the DocDOMs land straight in the corpus.

    adb reverse tcp:8099 tcp:8099
    python device_server.py --device galaxy-a71-8gb

THE CONTROL THIS CARRIES. `--device` is checked against `devices.py`, and the
handset's OWN reported `totalMemoryMb` is checked against the registry entry.
Claiming `galaxy-a16-5g-4gb` while holding an 8GB A71 is refused, not recorded.
Without that, the label is a promise the operator makes to themselves — and the
whole point of `devices.py` is that a label nobody checks is not a control.

Multi-page documents are posted a page at a time and merged here, reusing the
same concatenate-and-renumber shape `preview_score.ocr_pages` uses, so the file
that lands is indistinguishable in structure from a sidecar reading.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import devices as dev
import provenance as prov

HERE = os.path.dirname(os.path.abspath(__file__))

# The engine directory name. ML Kit on Android, Vision on iOS -- recorded
# because §6.4 keeps engine outputs side by side and a reading is only
# comparable to another from the same engine.
ENGINE_BY_PLATFORM = {'android': 'mlkit', 'ios': 'vision'}

# ActivityManager's totalMem is a few hundred MB under the nominal figure, and
# varies with what the kernel reserves. This only has to be tight enough to
# tell a 4GB phone from an 8GB one.
RAM_TOLERANCE_MB = 1024


class Bench:
    def __init__(self, manifest_path: str, device: str, limit: int) -> None:
        self.device = device
        self.entry = dev.get(device)
        manifest = json.load(open(manifest_path, encoding='utf-8'))
        prov.assert_manifest_provenance_valid(manifest)
        docs = manifest['documents'][:limit] if limit else manifest['documents']
        self.documents = {
            d['id']: [p if os.path.isabs(p) else os.path.join(HERE, p) for p in d['pages']]
            for d in docs
        }
        self.tier = prov.weakest_tier(docs)
        self.pending: dict[str, dict[int, dict]] = {}
        self.written: list[str] = []
        self.timings: list[float] = []
        self.lock = threading.Lock()
        self.out_root: str | None = None
        self.run_log: dict = {'device': device, 'documents': {}, 'device_reported': None}

    def _flush_run_log(self, root: str) -> None:
        """Rewrite the run log after every document, so a kill loses nothing."""
        times = [t for d in self.run_log['documents'].values() for t in d['recogniseMs']]
        summary = None
        if times:
            ordered = sorted(times)
            summary = {
                'pages': len(ordered),
                'medianMs': ordered[len(ordered) // 2],
                'p95Ms': ordered[min(len(ordered) - 1, int(0.95 * len(ordered)))],
                'maxMs': ordered[-1],
            }
        ok, why = dev.may_decide_fit(self.device)
        payload = {
            **self.run_log,
            'recognise_summary': summary,
            # Carried IN the artefact, not just printed once. A timing file
            # that does not say what it may conclude gets quoted as though it
            # were the gate.
            'may_decide_fit': ok,
            'fit_reason': why,
        }
        with open(os.path.join(root, '_run.json'), 'w', encoding='utf-8') as f:
            json.dump(payload, f, indent=2)

    def check_handset(self, reported: dict) -> str | None:
        """Refuse a handset that is not the one `--device` claims."""
        platform = reported.get('platform')
        if platform not in ENGINE_BY_PLATFORM:
            return f'unknown platform {platform!r}'
        if platform != self.entry['platform']:
            return (
                f'--device {self.device} is a {self.entry["platform"]} device but the '
                f'handset reports {platform}'
            )
        ram = reported.get('totalMemoryMb')
        if not isinstance(ram, (int, float)):
            return 'handset reported no totalMemoryMb'
        if abs(ram - self.entry['ram_mb']) > RAM_TOLERANCE_MB:
            return (
                f'handset reports {int(ram)} MB but {self.device} is registered at '
                f'{self.entry["ram_mb"]} MB. Either the wrong --device was named or this '
                f'phone is not in devices.py. A label nobody checks is not a control.'
            )
        return None

    def output_root(self, platform: str) -> str:
        if self.out_root is None:
            self.out_root = os.path.join(
                HERE, 'corpus', 'device', ENGINE_BY_PLATFORM[platform], self.device)
            os.makedirs(self.out_root, exist_ok=True)
        return self.out_root

    def accept_page(self, doc_id: str, page_no: int, payload: dict) -> str | None:
        pages = self.documents.get(doc_id)
        if pages is None:
            return f'unknown document {doc_id!r}'
        with self.lock:
            self.pending.setdefault(doc_id, {})[page_no] = payload
            got = self.pending[doc_id]
            if len(got) < len(pages):
                return None
            merged = merge_pages([got[n] for n in sorted(got)])
            root = self.output_root(payload['device']['platform'])
            with open(os.path.join(root, f'{doc_id}.json'), 'w', encoding='utf-8') as f:
                json.dump(merged, f, indent=2)
            self.written.append(doc_id)
            per_page = [p.get('timings', {}).get('recogniseMs', 0.0) for p in got.values()]
            self.timings.extend(per_page)
            # Persisted per document, NOT held until shutdown. The first full
            # run lost every timing because the server was killed rather than
            # interrupted, so the `finally` that printed them never ran --
            # 300 documents of real handset measurement, gone, for want of a
            # write. §6.4 asks for timings; keeping them only in memory meant
            # the corpus could not answer for itself.
            self.run_log['documents'][doc_id] = {
                'recogniseMs': per_page,
                'pages': len(per_page),
            }
            self.run_log['device_reported'] = payload['device']
            self._flush_run_log(root)
            del self.pending[doc_id]
        return None


def merge_pages(payloads: list[dict]) -> dict:
    """Concatenate per-page readings into one DocDOM, renumbering as we go.

    The native module always reports `page: 1` and ids of the form `blk-p1` /
    `ln-p1-<n>`, because it only ever sees one image. Merging without
    renumbering would produce a document whose every block claims page 1 and
    whose ids collide -- and `structure()` scans runs WITHIN a line, so
    collisions are not cosmetic.
    """
    merged = {'version': '1.0.0', 'pages': [], 'blocks': [],
              'tables': [], 'figures': [], 'fields': [], 'unreadable': []}
    for n, payload in enumerate(payloads, 1):
        doc = payload['document']
        for page in doc.get('pages') or []:
            merged['pages'].append({**page, 'number': n})
        for b, block in enumerate(doc.get('blocks') or []):
            lines = []
            for ln in block.get('lines') or []:
                spans = [{**s, 'id': f'sp-p{n}-l{ln["order"]}-w{w}'}
                         for w, s in enumerate(ln.get('spans') or [])]
                lines.append({**ln, 'id': f'ln-p{n}-{ln["order"]}', 'spans': spans})
            merged['blocks'].append({**block, 'id': f'blk-p{n}-{b}', 'page': n, 'lines': lines})
        for u in doc.get('unreadable') or []:
            merged['unreadable'].append({**u, 'page': n})
    return merged


def make_handler(bench: Bench):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'

        def log_message(self, *args):  # quiet; progress is printed below
            pass

        def _send(self, code: int, body: bytes, ctype: str) -> None:
            self.send_response(code)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _json(self, code: int, obj) -> None:
            self._send(code, json.dumps(obj).encode(), 'application/json')

        def do_GET(self):
            parts = [p for p in self.path.split('?')[0].split('/') if p]
            if parts == ['manifest']:
                return self._json(200, {
                    'device': bench.device,
                    'label': bench.entry['label'],
                    'tier': bench.tier,
                    'documents': [{'id': k, 'pages': len(v)}
                                  for k, v in bench.documents.items()],
                })
            if len(parts) == 3 and parts[0] == 'page':
                pages = bench.documents.get(parts[1])
                try:
                    path = pages[int(parts[2]) - 1]
                except (TypeError, ValueError, IndexError):
                    return self._json(404, {'error': 'no such page'})
                with open(path, 'rb') as f:
                    return self._send(200, f.read(), 'image/png')
            return self._json(404, {'error': 'not found'})

        def do_POST(self):
            parts = [p for p in self.path.split('?')[0].split('/') if p]
            length = int(self.headers.get('Content-Length') or 0)
            try:
                payload = json.loads(self.rfile.read(length).decode('utf-8'))
            except Exception as exc:
                return self._json(400, {'error': f'bad json: {exc}'})

            if len(parts) == 3 and parts[0] == 'page':
                problem = bench.check_handset(payload.get('device') or {})
                if problem:
                    print(f'REFUSED: {problem}', file=sys.stderr, flush=True)
                    return self._json(409, {'error': problem})
                err = bench.accept_page(parts[1], int(parts[2]), payload)
                if err:
                    return self._json(400, {'error': err})
                done, total = len(bench.written), len(bench.documents)
                if done:
                    print(f'[{done}/{total}] {parts[1]}', flush=True)
                return self._json(200, {'ok': True, 'written': done, 'total': total})
            return self._json(404, {'error': 'not found'})

    return Handler


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--manifest', default='corpus/generated/manifest.json')
    ap.add_argument('--device', required=True,
                    help='must be registered in devices.py, e.g. galaxy-a71-8gb')
    ap.add_argument('--port', type=int, default=8099)
    ap.add_argument('--limit', type=int, default=0)
    args = ap.parse_args()

    try:
        dev.get(args.device)
    except dev.UnknownDevice as exc:
        print(f'REFUSED: {exc}', file=sys.stderr)
        return 2

    path = args.manifest if os.path.isabs(args.manifest) else os.path.join(HERE, args.manifest)
    bench = Bench(path, args.device, args.limit)

    print(dev.banner(args.device))
    print()
    print(f'{len(bench.documents)} documents, tier {bench.tier}')
    print(f'listening on 0.0.0.0:{args.port}')
    print(f'  on the handset, run:  adb reverse tcp:{args.port} tcp:{args.port}')
    print(f'  then open the dev bench screen and press Run.')
    print()

    server = ThreadingHTTPServer(('0.0.0.0', args.port), make_handler(bench))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        n = len(bench.written)
        print(f'\n{n}/{len(bench.documents)} documents written')
        if bench.timings:
            ordered = sorted(bench.timings)
            median = ordered[len(ordered) // 2]
            print(f'recogniseMs  median {median:.0f}  max {ordered[-1]:.0f}')
            ok, why = dev.may_decide_fit(args.device)
            if not ok:
                print(f'  NOT the §6.1 gate: {why}')
        if bench.out_root:
            print(f'written to {bench.out_root}')
            print(f'score with:  python preview_score.py --manifest {args.manifest} \\\n'
                  f'               --docdom-dir {os.path.relpath(bench.out_root, HERE)} '
                  f'--device {args.device}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
