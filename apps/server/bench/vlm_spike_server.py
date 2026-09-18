"""OD-15 spike harness: serve sample dockets to a handset, collect VLM timings.

    adb reverse tcp:8100 tcp:8100
    python vlm_spike_server.py --device galaxy-a71-8gb --model gemma-4-e2b
    python vlm_spike_server.py --device galaxy-a71-8gb --model florence-2-base

Same shape as `device_server.py` (§6.4 step 2's `snap-ocr` harness), because
the control it enforces is the same one: `--device` is checked against
`devices.py`, and the handset's OWN reported `totalMemoryMb` is checked
against the registry entry, so a label nobody verifies cannot stand in for a
measurement (`devices.py` module docstring).

WHAT THE PHONE SIDE MUST DO. This ticket's files are `apps/server/bench/`
only; the dev-build screen that drives `react-native-executorch` or
`llama.rn` and POSTs the result below lives in `apps/mobile/`, which is
explicitly out of scope here (another agent owns `apps/mobile/src/` and
`apps/mobile/modules/snap-ocr/` right now). That screen needs to, per model:

  1. Load the model, timing model-load from first byte read to ready-for-
     inference (`timings.modelLoadMs`), and recording whether this run paid
     a first-run download (`weights.source: 'downloaded'`) or reused a
     prior one (`'cached'`) or shipped bundled (`'bundled'`), plus the byte
     count actually transferred (`weights.bytes`, 0 if not downloaded).
  2. Fetch one sample image from GET /image/<id> (the manifest is at
     GET /manifest), run the model over it, and time from "inference
     started" to "first structured field value available"
     (`timings.timeToFirstFieldMs`) -- the same instant §1.3's own
     "time-to-first-field" budget line measures for `snap-ocr`, so the two
     numbers sit in one table without redefinition.
  3. Sample peak resident memory during steps 1-2 (Android:
     `ActivityManager.MemoryInfo` / `Debug.MemoryInfo` at intervals;
     iOS: `task_vm_info.phys_footprint`) and report the max as
     `peakMemoryMb`.
  4. Report `device.totalMemoryMb` exactly as `SnapOcrModule.deviceInfo()`
     already does (`devices.py` line 29) -- reuse that native call rather
     than a new one.
  5. POST the JSON body documented in `vlm_spike.validate_result` to
     POST /result on this server (reachable at 127.0.0.1:<port> over
     `adb reverse`, same as device_server.py).

THIS SERVER NEVER RUNS A MODEL. It is a receiver, a validator, and a
reporter -- consistent with `device_server.py` and with the hard rule this
ticket was given: no device is attached, so no number may be invented here.
"""
from __future__ import annotations

import argparse
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import devices as dev
import vlm_spike as spike


def make_handler(device: str, model: str):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'

        def log_message(self, *args):  # progress is printed explicitly below
            pass

        def _json(self, code: int, obj) -> None:
            body = json.dumps(obj).encode('utf-8')
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            parts = [p for p in self.path.split('?')[0].split('/') if p]
            if parts == ['manifest']:
                return self._json(200, {
                    'device': device,
                    'model': model,
                    'runtime_options': spike.MODELS[model]['runtime_options'],
                    'runtime_caveat': spike.MODELS[model]['runtime_caveat'],
                    'images': list(SAMPLE_IMAGES),
                })
            if len(parts) == 2 and parts[0] == 'image' and parts[1] in SAMPLE_IMAGES:
                with open(SAMPLE_IMAGES[parts[1]], 'rb') as f:
                    data = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'image/png')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            return self._json(404, {'error': 'not found'})

        def do_POST(self):
            parts = [p for p in self.path.split('?')[0].split('/') if p]
            if parts != ['result']:
                return self._json(404, {'error': 'not found'})
            length = int(self.headers.get('Content-Length') or 0)
            try:
                payload = json.loads(self.rfile.read(length).decode('utf-8'))
            except Exception as exc:
                return self._json(400, {'error': f'bad json: {exc}'})
            try:
                path = spike.record_result(device, payload)
            except (spike.SpikeValidationError, dev.UnknownDevice) as exc:
                print(f'REFUSED: {exc}', file=sys.stderr, flush=True)
                return self._json(422, {'error': str(exc)})
            print(f'recorded run for {payload.get("model")} -> {path}', flush=True)
            summary = spike.summarise(payload['model'], device)
            print(json.dumps(summary, indent=2), flush=True)
            return self._json(200, {'ok': True, 'summary': summary})

    return Handler


SAMPLE_IMAGES = {
    'receipt-easy': __file__.replace('vlm_spike_server.py', 'receipt.png'),
    'receipt-hard': __file__.replace('vlm_spike_server.py', 'receipt-hard.png'),
    'receipt-hard-s': __file__.replace('vlm_spike_server.py', 'receipt-hard-s.png'),
}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--device', required=True,
                     help='must be registered in devices.py, e.g. galaxy-a71-8gb')
    ap.add_argument('--model', required=True, choices=sorted(spike.MODELS),
                     help='which of §2.1\'s two Stage 3(b) candidates this run is measuring')
    ap.add_argument('--port', type=int, default=8100)
    args = ap.parse_args()

    try:
        dev.get(args.device)
    except dev.UnknownDevice as exc:
        print(f'REFUSED: {exc}', file=sys.stderr)
        return 2

    spec = spike.MODELS[args.model]
    print(dev.banner(args.device))
    print()
    print(f'model: {spec["label"]}  licence: {spec["licence"]} (D23: '
          f'{"passes" if spec["passes_d23"] else "FAILS"})')
    print(f'runtime options: {", ".join(spec["runtime_options"])}')
    print(f'runtime caveat: {spec["runtime_caveat"]}')
    print()
    print(f'listening on 0.0.0.0:{args.port}')
    print(f'  on the handset:  adb reverse tcp:{args.port} tcp:{args.port}')
    print('  then run the dev-build VLM spike screen and press Run for this model.')
    print()

    server = ThreadingHTTPServer(('0.0.0.0', args.port), make_handler(args.device, args.model))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        summary = spike.summarise(args.model, args.device)
        if summary is None:
            print('\nno runs recorded -- nothing to report. Nothing was written to results/.')
        else:
            print('\n' + json.dumps(summary, indent=2))
            row = spike.render_od2_2_row(args.model, args.device)
            print('\n§2.2 row (paste into docs/ON-DEVICE.md):')
            print(row)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
