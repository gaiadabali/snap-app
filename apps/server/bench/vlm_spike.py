"""OD-15 — Gemma 4 E2B / Florence-2-base floor-device spike: shared logic.

`docs/ON-DEVICE.md` §8 Stage 3(b) and the OD-15 ticket in §11: record
time-to-first-field, peak memory and first-run download for the strongest
licence-clean VLM candidates (§2.1, §2.2), on the floor devices, so the
"why not a VLM" answer in §0/§9 stays current instead of frozen at the 2026-09
research pass.

WHAT THIS FILE IS NOT. It does not run a model. There is no Python inference
here and there must not be: `react-native-executorch` and `llama.rn` are React
Native / native-module runtimes with no Python binding, so the model only ever
runs inside the app's dev build, on the phone, exactly as `device_server.py`
already requires for `snap-ocr`. This file is the receiving side — the same
role `device_server.py` plays for DocDOM exports — plus the registry of which
model/runtime/licence combinations are even worth pointing a phone at.

LICENCE FLOOR CHECKED FIRST, PER THE TICKET. D23 is Apache-2.0 or MIT weights
only, in anything redistributable. `docs/ON-DEVICE.md` §2.1/§2.2/§5 already
did this reading and is cited here rather than re-derived:

  Gemma 4 E2B (LiteRT-LM)  Apache-2.0  **[verified]** ON-DEVICE.md §2.1 —
      LiteRT-LM model page and the Google Open Source blog, Mar 2026. Passes
      D23. (Gemma 1-3 remain under the non-OSI Gemma Terms; NOT this model.)
  Florence-2-base          MIT         **[verified]** ON-DEVICE.md §2.1 —
      the HF model card. Passes D23.
  react-native-executorch  MIT         **[verified]** `npm view
      react-native-executorch license` on 2026-09-18. Passes D23 (a runtime
      dependency, not shipped weights, but MIT clears the floor either way).
  llama.rn                 MIT         **[verified]** `npm view llama.rn
      license` on 2026-09-18, and ON-DEVICE.md §2.4/§4 which already read the
      README as MIT. Passes D23.

All four clear D23. The reason §2.2 recommends against Gemma 4 E2B is the
BUDGET (§1.3), not the licence — see the module docstring in `devices.py` for
the parallel point about function vs. fit.

A FORMAT MISMATCH FLAGGED IN AN EARLIER PASS, RESOLVED 2026-09-18 -- ONE
RESULT EACH WAY. Gemma 4 E2B's published artefact is `.litertlm`
(MediaPipe/LiteRT-LM format); `llama.rn` loads GGUF (`llama.cpp`) format and
`react-native-executorch` loads `.pte` (ExecuTorch) format. Neither runtime
consumes `.litertlm` directly.

  * Gemma 4 E2B -- CONFIRMED REACHABLE, no export needed. `unsloth/gemma-4-E2B-it-GGUF`
    is a real, public repo (`apache-2.0` on its own `cardData`,
    `Gemma4ForConditionalGeneration` architecture) **[verified]** HF API,
    2026-09-18. The Q4_K_M tier is `gemma-4-E2B-it-Q4_K_M.gguf` at
    3,106,738,272 bytes, plus `mmproj-F16.gguf` at 985,654,080 bytes for the
    vision path -- both sizes read off the repo's own file tree
    **[verified]**. llama.cpp's Gemma 4 support is a dated, merged PR
    (`ggml-org/llama.cpp` #21309, 2026-04-02) **[verified]** GitHub API, not a
    claim taken on trust. Point `llama.rn` at those two files directly.
  * Florence-2-base -- CONFIRMED NOT REACHABLE through optimum-executorch's
    documented CLI path, as of this pass. The export was actually attempted
    (CPU torch 2.14, `optimum-executorch` from the `main` branch, 2026-09-18),
    not judged from documentation alone. `--task image-to-text` isn't a
    registered task in `optimum-executorch` at all (`TypeError: 'NoneType'
    object is not callable`). `--task image-text-to-text` -- the closest
    registered task, and Florence-2-base's own published `pipeline_tag` --
    downloads the real checkpoint but loads it through generic
    `AutoModelForPreTraining`, which comes back with a LOAD REPORT marking
    essentially the entire vision tower and language model
    `UNEXPECTED`/`MISSING`: the checkpoint's weights don't land on the
    loader's expected keys, so the graph that would be exported carries
    random weights, not Florence-2-base's trained ones. See
    `docs/ON-DEVICE.md` §2.2 for the full transcript and exact commands.
    **Florence-2-base cannot currently be exported to a correct `.pte` this
    way; no working artefact exists for `react-native-executorch` to load.**

NO MEASUREMENT IS FABRICATED HERE. Every number this module reports came from
a POST the phone sent; there is no default, no placeholder figure, and no
"typical range" standing in for one. `adb devices` was empty for the whole of
this ticket, so `results/vlm_spike/` is empty and stays that way until someone
runs the harness below against a real handset.
"""
from __future__ import annotations

import json
import os
import time

import devices as dev

HERE = os.path.dirname(os.path.abspath(__file__))
RESULTS_ROOT = os.path.join(HERE, 'results', 'vlm_spike')

# A nominal "N GB" phone reports a few hundred MB less through
# ActivityManager / host_statistics64 than the marketing figure. Same
# tolerance and same reasoning as device_server.py's RAM_TOLERANCE_MB: this
# only has to be tight enough to catch "wrong phone plugged in", not to
# split hairs.
RAM_TOLERANCE_MB = 1024

RUNTIME_LITERTLM = 'litertlm-format-mismatch'  # see module docstring

MODELS: dict[str, dict] = {
    'gemma-4-e2b': {
        'label': 'Gemma 4 E2B (LiteRT-LM)',
        'licence': 'Apache-2.0',
        'passes_d23': True,
        'licence_source': (
            'docs/ON-DEVICE.md §2.1 — LiteRT-LM model page and Google Open '
            'Source blog, Mar 2026 [verified]'
        ),
        'on_disk_bytes_cited': 2_580_000_000,  # 2.58 GB, ON-DEVICE.md §2.1/§2.2 [cited from Google, for the .litertlm artefact -- NOT what llama.rn will download; see gguf_artefact below]
        'runtime_options': ('llama.rn',),
        'runtime_caveat': (
            'RESOLVED 2026-09-18: no export needed. unsloth/gemma-4-E2B-it-GGUF '
            'is a verified real artefact (apache-2.0, Gemma4ForConditionalGeneration) '
            'and llama.cpp has carried Gemma 4 support since PR #21309 '
            '(2026-04-02, verified). Point llama.rn at gguf_artefact below.'
        ),
        # Confirmed 2026-09-18 against the repo's own file tree via the HF API
        # (`GET /api/models/unsloth/gemma-4-E2B-it-GGUF/tree/main`) -- not an
        # estimate, and not the .litertlm figure above (different artefact).
        'gguf_artefact': {
            'repo': 'unsloth/gemma-4-E2B-it-GGUF',
            'licence': 'Apache-2.0',  # cardData on the repo itself [verified]
            'weights_file': 'gemma-4-E2B-it-Q4_K_M.gguf',
            'weights_bytes': 3_106_738_272,
            'mmproj_file': 'mmproj-F16.gguf',  # required for the vision path
            'mmproj_bytes': 985_654_080,
            'combined_first_run_download_bytes': 3_106_738_272 + 985_654_080,  # ~4.09 GB
            'llama_cpp_support_pr': 'ggml-org/llama.cpp#21309',
            'llama_cpp_support_merged': '2026-04-02',
        },
    },
    'florence-2-base': {
        'label': 'Florence-2-base',
        'licence': 'MIT',
        'passes_d23': True,
        'licence_source': 'docs/ON-DEVICE.md §2.1 — HF model card [verified]',
        'on_disk_bytes_cited': 500_000_000,  # ~0.5 GB f16, ON-DEVICE.md §2.1 [estimate]; the real checkpoint (microsoft/Florence-2-base model.safetensors) measured 463,221,266 bytes [verified] HF file tree, 2026-09-18 -- close to the estimate, recorded here for provenance even though the export itself failed
        'runtime_options': ('react-native-executorch',),
        'runtime_caveat': (
            'BLOCKED, attempted and failed 2026-09-18, not just judged unlikely: '
            '`optimum-cli export executorch --task image-to-text` fails (task not '
            'registered); `--task image-text-to-text` (the closest registered task, '
            'and this model\'s own pipeline_tag) downloads the real checkpoint but '
            'loads it via generic AutoModelForPreTraining, whose LOAD REPORT marks '
            'essentially the whole vision tower and language model UNEXPECTED/MISSING '
            '-- the exported graph would carry random weights, not this model\'s. '
            'No correct .pte exists for react-native-executorch to load. Full '
            'transcript: docs/ON-DEVICE.md §2.2.'
        ),
        'export_attempted': True,
        'export_succeeded': False,
    },
}

RUNTIME_LICENCES = {
    # npm view <pkg> license, 2026-09-18.
    'react-native-executorch': {'licence': 'MIT', 'passes_d23': True},
    'llama.rn': {'licence': 'MIT', 'passes_d23': True},
}

REQUIRED_TIMING_KEYS = ('modelLoadMs', 'timeToFirstFieldMs')


class SpikeValidationError(ValueError):
    """Raised for a POSTed spike result that does not carry what §1.3/§2.2 need."""


def validate_result(device: str, payload: dict) -> None:
    """Raise naming exactly what is wrong, rather than writing a partial number.

    Mirrors `device_server.Bench.check_handset` for the device-identity check,
    then additionally requires the fields OD-15's "done when" names: a
    time-to-first-field, a peak memory figure, and a first-run download
    figure (which may genuinely be 0 bytes if the run reused a prior
    download — that is a real answer, not a missing one, so it must be
    present and explicit rather than defaulted).
    """
    model = payload.get('model')
    if model not in MODELS:
        raise SpikeValidationError(
            f'unknown model {model!r}. Known: {", ".join(sorted(MODELS))}'
        )
    spec = MODELS[model]

    runtime = payload.get('runtime')
    if runtime not in spec['runtime_options']:
        raise SpikeValidationError(
            f'{model} was run under runtime {runtime!r}; §11 OD-15 and this '
            f'registry expect one of {spec["runtime_options"]} for this model'
        )

    entry = dev.get(device)
    reported = payload.get('device') or {}
    platform = reported.get('platform')
    if platform != entry['platform']:
        raise SpikeValidationError(
            f'--device {device} is a {entry["platform"]} device but the '
            f'handset reported platform {platform!r}'
        )
    ram = reported.get('totalMemoryMb')
    if not isinstance(ram, (int, float)):
        raise SpikeValidationError('handset reported no totalMemoryMb')
    if abs(ram - entry['ram_mb']) > RAM_TOLERANCE_MB:
        raise SpikeValidationError(
            f'handset reports {int(ram)} MB but {device} is registered at '
            f'{entry["ram_mb"]} MB in devices.py. A label nobody checks is '
            'not a control (devices.py docstring).'
        )

    timings = payload.get('timings') or {}
    missing_timings = [k for k in REQUIRED_TIMING_KEYS if not isinstance(timings.get(k), (int, float))]
    if missing_timings:
        raise SpikeValidationError(
            f'timings missing or non-numeric: {", ".join(missing_timings)}. '
            'OD-15 is "done when" time-to-first-field is recorded — a run '
            'that did not measure it is not a result.'
        )

    if not isinstance(payload.get('peakMemoryMb'), (int, float)):
        raise SpikeValidationError(
            'peakMemoryMb missing or non-numeric. OD-15 needs peak memory '
            'recorded, not inferred from the model card.'
        )

    weights = payload.get('weights') or {}
    if not isinstance(weights.get('bytes'), (int, float)):
        raise SpikeValidationError(
            'weights.bytes (the first-run download size actually observed, '
            '0 if none was needed) is missing or non-numeric.'
        )
    if weights.get('source') not in ('downloaded', 'bundled', 'cached'):
        raise SpikeValidationError(
            "weights.source must be one of 'downloaded' / 'bundled' / "
            "'cached' -- which one determines whether weights.bytes is a "
            "real first-run download or a no-op on a warm device."
        )

    output = payload.get('output') or {}
    if not isinstance(output.get('raw'), str) or not output['raw'].strip():
        raise SpikeValidationError(
            "output.raw is empty. FUNCTION -- does the model load and "
            "produce a field at all -- is exactly what an above-floor "
            "device like galaxy-a71-8gb IS allowed to settle "
            "(devices.py may_decide_fit); a run with no output settles "
            "nothing at all and should not be recorded as a result."
        )


def result_path(model: str, device: str) -> str:
    return os.path.join(RESULTS_ROOT, model, f'{device}.json')


def record_result(device: str, payload: dict) -> str:
    """Validate, stamp with the fit/function verdict, and write to disk.

    One file per (model, device): a spike is a handful of runs, not a
    300-document corpus pass, so there is no merge-by-page step like
    `device_server.merge_pages` -- each POST simply appends to that file's
    `runs` list, most-recent-last, and the file's own `may_decide_fit` is
    recomputed every time so it can never drift from `devices.py`.
    """
    validate_result(device, payload)
    model = payload['model']
    path = result_path(model, device)
    os.makedirs(os.path.dirname(path), exist_ok=True)

    existing = {'device': device, 'model': model, 'runs': []}
    if os.path.exists(path):
        with open(path, encoding='utf-8') as f:
            existing = json.load(f)

    ok, why = dev.may_decide_fit(device)
    stamped = {
        **payload,
        'recordedAtUnix': time.time(),
    }
    existing['runs'].append(stamped)
    existing['device_role'] = dev.role_of(device)
    existing['may_decide_fit'] = ok
    existing['fit_reason'] = why

    with open(path, 'w', encoding='utf-8') as f:
        json.dump(existing, f, indent=2, ensure_ascii=False)
    return path


def summarise(model: str, device: str) -> dict | None:
    """Median/first-run/peak-memory rollup for one (model, device) file, or None."""
    path = result_path(model, device)
    if not os.path.exists(path):
        return None
    with open(path, encoding='utf-8') as f:
        data = json.load(f)
    runs = data.get('runs') or []
    if not runs:
        return None
    ttff = sorted(r['timings']['timeToFirstFieldMs'] for r in runs)
    load = sorted(r['timings']['modelLoadMs'] for r in runs)
    peak = sorted(r['peakMemoryMb'] for r in runs)
    # First-run download is only meaningful on the run that actually paid it;
    # a warm/cached rerun reporting 0 bytes must not average away the cold
    # figure, so report the max observed rather than a mean across mixed runs.
    downloaded = [r['weights']['bytes'] for r in runs if r['weights']['source'] == 'downloaded']
    return {
        'device': device,
        'device_role': data.get('device_role'),
        'may_decide_fit': data.get('may_decide_fit'),
        'fit_reason': data.get('fit_reason'),
        'n_runs': len(runs),
        'time_to_first_field_ms_median': ttff[len(ttff) // 2],
        'model_load_ms_median': load[len(load) // 2],
        'peak_memory_mb_max': peak[-1],
        'first_run_download_bytes': max(downloaded) if downloaded else 0,
        'output_sample': runs[-1]['output']['raw'][:200],
    }


def render_od2_2_row(model: str, device: str) -> str | None:
    """A pasteable §2.2 markdown row, honest about what the device can settle.

    §2.2's table already carries one row of *cited* Gemma-4-E2B figures from
    Google's own flagship benchmarks; this renders the *measured* companion
    row for whichever device actually ran, with the FIT caveat inline rather
    than left for a reader to look up in devices.py.
    """
    s = summarise(model, device)
    if s is None:
        return None
    entry = dev.get(device)
    spec = MODELS[model]
    fit_note = (
        '' if s['may_decide_fit']
        else ' — **does not settle §6.1** (above-floor device; function only, see devices.py)'
    )
    return (
        f"| {spec['label']} on {entry['label']} | "
        f"time-to-first-field **{s['time_to_first_field_ms_median']:.0f} ms** (median of "
        f"{s['n_runs']}), model load {s['model_load_ms_median']:.0f} ms, "
        f"peak memory **{s['peak_memory_mb_max']:.0f} MB**, first-run download "
        f"**{s['first_run_download_bytes'] / 1e6:.0f} MB** "
        f"**[measured]**{fit_note} |"
    )
