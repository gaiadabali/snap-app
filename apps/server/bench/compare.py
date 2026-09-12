"""Real evaluation harness — rebuild of the old compare.py per contract §6
(docs/contracts/phase0-multipage.md) and docs/OCR.md §8.1.

What changed from the old compare.py, and why (see docs/OCR.md §8.1 for the
full argument):

  - MULTIPLE documents with per-field ground truth in manifest.json, not
    embedded in this script. One synthetic image scored 8/8 by five of six
    models and could no longer discriminate anything.
  - A MULTI-PAGE PDF is in the set from the start (invoice-multipage), because
    nothing has ever been measured on one and it is the capability gap
    driving Phase 0.
  - PER-FIELD scoring: exact / normalised / wrong / miss / ABSTENTION-success
    / hallucinated (scoring.py). A null in the ground truth is a fact about
    the document, and a model returning null there is correct, not a miss.
  - REPEATED runs, so latency is a median instead of one sample. router.ts
    carries the old single-sample numbers as `medianSeconds`; they are not
    medians and should be replaced once this harness has run enough repeats
    on the production provider to justify it (that replacement is NOT done
    by this script — it only measures; router.ts is lane B/C territory).
  - STRUCTURED output: JSON + markdown, written under results/<timestamp>/,
    recording model, prompt version, timestamp, and run count.
  - PLUGGABLE engines behind engines/*: the hosted vision models, plus
    PaddleOCR / Docling / LlamaParse adapters that report "not run" with a
    specific reason when their dependency or key is absent. Nothing here
    invents a score for an engine that did not run.

Usage:
    python compare.py                                   # small default run
    python compare.py --models gemma4:31b minimax-m3     # pick hosted models
    python compare.py --docs receipt-easy receipt-noabn  # pick documents
    python compare.py --repeats 3                        # default is 3
    python compare.py --dry-run                          # plumbing check,
                                                          # no network calls
    python compare.py --other-engines                    # also probe
                                                          # paddleocr/docling/
                                                          # llamaparse (they
                                                          # will report "not
                                                          # run" unless
                                                          # installed)

The provider is shared and weekly-rate-limited (docs/AI.md, project CLAUDE.md)
-- keep --models and --repeats small for routine runs.
"""
import argparse
import json
import os
import statistics
import sys
import time
from datetime import datetime, timezone

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from engines.hosted import HostedEngine
from engines.paddleocr_engine import PaddleOCREngine
from engines.docling_engine import DoclingEngine
from engines.llamaparse_engine import LlamaParseEngine
from engines import EngineResult
import scoring
import abn

HERE = os.path.dirname(os.path.abspath(__file__))

DEFAULT_MODELS = ['gemma4:31b', 'minimax-m3']  # small, deliberate default — see module docstring
DEFAULT_REPEATS = 3
DEFAULT_TIMEOUT = 240

PROMPT_V1 = """You are extracting structured data from an Australian receipt or tax invoice. \
You may be given more than one image — they are consecutive pages of ONE document, in order. \
Read every page before answering; totals and GST are sometimes only printed on the last page.

Return ONLY minified JSON, no prose, with exactly these keys:
{"supplier_name":string|null,"supplier_abn":string|null,"issue_date":"YYYY-MM-DD"|null,
"total_inclusive":string|null,"gst_amount":string|null,"is_tax_invoice":boolean,
"line_count":number,"page_count":number,
"lines":[{"description":string,"amount":string}]}

Rules:
- supplier_abn: digits only, no spaces. null if not printed anywhere in the document.
- Amounts: plain decimal strings, no currency symbol.
- is_tax_invoice: true only if the words "tax invoice" appear on the document.
- gst_amount: null if the document does not state a GST figure. Do not compute one yourself.
- line_count: the number of line items you can see, across all pages.
- page_count: how many images you were given.
- If a field is not legible or not printed, return null. NEVER guess a value."""


def load_manifest():
    with open(os.path.join(HERE, 'manifest.json'), encoding='utf-8') as f:
        manifest = json.load(f)
    # Durable fix, not a one-time patch: a ground-truth ABN that fails its own
    # checksum makes the corpus unable to prove anything about the mod-89
    # defence (an invalid truth scores a correct and incorrect reading
    # identically). Refuse to run rather than silently trusting stale truth.
    abn.assert_manifest_abns_valid(manifest)
    return manifest


def resolve_pages(doc: dict) -> list[str]:
    return [os.path.join(HERE, p) for p in doc['pages']]


def build_engines(model_ids: list[str], other_engines: bool):
    engines = [HostedEngine(m) for m in model_ids]
    if other_engines:
        engines += [PaddleOCREngine(), DoclingEngine(), LlamaParseEngine()]
    return engines


def run_one(engine, doc, prompt, timeout, dry_run) -> EngineResult:
    if dry_run:
        # Plumbing check only: no network call, no fabricated score. `parsed`
        # is None so scoring reports every field as UNPARSEABLE, not as a
        # pass — a dry run must never look like a real result.
        time.sleep(0.01)
        return EngineResult(text='[dry-run: no call made]', parsed=None, seconds=0.0, extra={'dry_run': True})
    return engine.run(resolve_pages(doc), prompt, timeout=timeout)


def mode_outcome(outcomes: list[str]) -> str:
    """Most frequent outcome across repeated runs, ties broken toward the
    worse-sounding one alphabetically stays out of scope -- report the
    literal mode and let the per-run detail in the JSON carry the rest."""
    counts = {}
    for o in outcomes:
        counts[o] = counts.get(o, 0) + 1
    return max(counts.items(), key=lambda kv: kv[1])[0]


def evaluate(manifest, engines, docs_filter, repeats, timeout, dry_run):
    documents = [d for d in manifest['documents'] if not docs_filter or d['id'] in docs_filter]
    prompt = PROMPT_V1

    results = []
    skipped = {}

    for engine in engines:
        ok, reason = engine.available()
        if not ok:
            skipped[engine.name] = reason
            print(f'-- {engine.name}: NOT RUN ({reason})')
            continue

        for doc in documents:
            print(f'-- {engine.name} x {doc["id"]} ({repeats} run(s))')
            seconds_all = []
            field_outcome_runs: dict[str, list[str]] = {f: [] for f in doc['fields']}
            lines_matched_all = []
            errors = []
            parse_failures = 0
            sample_text = None  # first run's raw output, kept for debugging a WRONG/MISS field

            for i in range(repeats):
                try:
                    res = run_one(engine, doc, prompt, timeout, dry_run)
                    ds = scoring.score_document(doc, res.parsed)
                    seconds_all.append(res.seconds)
                    for f, outcome in ds.outcomes.items():
                        field_outcome_runs[f].append(outcome)
                    if ds.lines_total:
                        lines_matched_all.append(ds.lines_matched)
                    if ds.parse_failed:
                        parse_failures += 1
                    if sample_text is None:
                        sample_text = res.text[:600]
                    tag = 'OK' if not ds.parse_failed else 'UNPARSEABLE'
                    print(f'   run {i+1}/{repeats}: {res.seconds:.1f}s  {tag}')
                except Exception as e:
                    errors.append(f'{type(e).__name__}: {str(e)[:200]}')
                    print(f'   run {i+1}/{repeats}: FAILED {type(e).__name__}: {str(e)[:120]}')

            entry = {
                'document': doc['id'],
                'engine': engine.name,
                'requested_runs': repeats,
                'completed_runs': len(seconds_all),
                'errors': errors,
                'median_seconds': statistics.median(seconds_all) if seconds_all else None,
                'seconds_all': seconds_all,
                'field_outcomes_by_run': field_outcome_runs,
                'field_outcome_mode': {f: mode_outcome(v) for f, v in field_outcome_runs.items() if v},
                'lines_total': doc.get('lines', {}).get('truth') and len(doc['lines']['truth']) or 0,
                'lines_matched_median': statistics.median(lines_matched_all) if lines_matched_all else None,
                'parse_failures': parse_failures,
                'sample_raw_output': sample_text,
            }
            results.append(entry)

    return {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'prompt_version': manifest.get('prompt_version', 'v1'),
        'dry_run': dry_run,
        'documents': [d['id'] for d in documents],
        'engines_run': [e.name for e in engines if e.name not in skipped],
        'engines_skipped': skipped,
        'results': results,
    }


OUTCOME_COLS = [
    (scoring.EXACT, 'exact'),
    (scoring.NORMALISED, 'norm'),
    (scoring.ABSTAIN_OK, 'abstain-ok'),
    (scoring.WRONG, 'wrong'),
    (scoring.MISS, 'miss'),
    (scoring.HALLUCINATED, 'halluc'),
    (scoring.UNPARSEABLE, 'unparse'),
]


def to_markdown(report: dict) -> str:
    lines = []
    lines.append(f"# Bench results — {report['generated_at']}")
    lines.append('')
    lines.append(f"prompt version: `{report['prompt_version']}`  ")
    lines.append(f"documents: {', '.join(report['documents'])}  ")
    lines.append(f"engines run: {', '.join(report['engines_run']) or '(none)'}  ")
    if report['dry_run']:
        lines.append('')
        lines.append('**DRY RUN — no engine was actually called. Every score below is a placeholder, not a measurement.**')
    lines.append('')
    if report['engines_skipped']:
        lines.append('## Not run')
        lines.append('')
        lines.append('| engine | reason |')
        lines.append('|---|---|')
        for name, reason in report['engines_skipped'].items():
            lines.append(f'| {name} | {reason} |')
        lines.append('')

    lines.append('## Per document x engine')
    lines.append('')
    header = ['document', 'engine', 'runs', 'median s'] + [c[1] for c in OUTCOME_COLS] + ['lines matched', 'errors']
    lines.append('| ' + ' | '.join(header) + ' |')
    lines.append('|' + '---|' * len(header))
    for r in report['results']:
        counts = {c[0]: 0 for c in OUTCOME_COLS}
        n_fields = 0
        for outcomes in r['field_outcomes_by_run'].values():
            if outcomes:
                mode = mode_outcome(outcomes)
                counts[mode] += 1
                n_fields += 1
        median_s = f"{r['median_seconds']:.1f}" if r['median_seconds'] is not None else '—'
        lines_cell = (f"{r['lines_matched_median']:.0f}/{r['lines_total']}"
                      if r['lines_matched_median'] is not None else (f"—/{r['lines_total']}" if r['lines_total'] else '—'))
        err_cell = f"{len(r['errors'])} failed" if r['errors'] else ''
        row = [r['document'], r['engine'], f"{r['completed_runs']}/{r['requested_runs']}", median_s]
        row += [str(counts[c[0]]) for c in OUTCOME_COLS]
        row += [lines_cell, err_cell]
        lines.append('| ' + ' | '.join(row) + ' |')
    lines.append('')
    lines.append('Each field-outcome column counts fields whose MODE outcome across the '
                  'repeated runs fell in that bucket, out of the fields defined for that '
                  'document in manifest.json. `abstain-ok` is a ground-truth null correctly '
                  'returned as null — a success, not a miss. `halluc` is a ground-truth null '
                  'that the model filled in anyway — worse than a miss.')
    return '\n'.join(lines) + '\n'


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--models', nargs='*', default=DEFAULT_MODELS, help='hosted model ids to run')
    ap.add_argument('--docs', nargs='*', default=None, help='document ids to run (default: all in manifest)')
    ap.add_argument('--repeats', type=int, default=DEFAULT_REPEATS)
    ap.add_argument('--timeout', type=int, default=DEFAULT_TIMEOUT)
    ap.add_argument('--other-engines', action='store_true',
                     help='also probe paddleocr/docling/llamaparse (report not-run if unavailable)')
    ap.add_argument('--dry-run', action='store_true', help='exercise the harness without calling any engine')
    ap.add_argument('--out-dir', default=os.path.join(HERE, 'results'))
    args = ap.parse_args()

    manifest = load_manifest()
    engines = build_engines(args.models, args.other_engines)

    report = evaluate(manifest, engines, args.docs, args.repeats, args.timeout, args.dry_run)

    ts = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    out_dir = os.path.join(args.out_dir, ts)
    os.makedirs(out_dir, exist_ok=True)
    json_path = os.path.join(out_dir, 'results.json')
    md_path = os.path.join(out_dir, 'results.md')
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2)
    with open(md_path, 'w', encoding='utf-8') as f:
        f.write(to_markdown(report))

    print()
    print(f'wrote {json_path}')
    print(f'wrote {md_path}')


if __name__ == '__main__':
    main()
