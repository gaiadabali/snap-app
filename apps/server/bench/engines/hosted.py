"""Adapter for the hosted vision models on Ollama Cloud's OpenAI-compatible
endpoint — the engine the old compare.py exercised exclusively.

Key resolution follows the same convention as apps/server/src/extraction/
provider.ts and scripts/extract.ts: OLLAMA_API_KEY (or OLLAMA_CLOUD_API_KEY)
in the environment takes priority, then OLLAMA_ENV_FILE pointing at a file
containing it. A hardcoded dev-machine fallback path is kept last, matching
run.py/e2e.py in this same directory, so the harness still runs unmodified on
this box. The key is never printed, logged, or included in any result file.
"""
import base64
import json
import os
import time
import urllib.error
import urllib.request

from . import EngineResult

_FALLBACK_KEY_PATH = r'C:\Users\Hansel\.claude\secrets\ollama-cloud.env'


def _read_key_file(path: str) -> str | None:
    if not path or not os.path.isfile(path):
        return None
    for line in open(path, encoding='utf-8'):
        line = line.strip()
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            if 'KEY' in k.upper() or 'TOKEN' in k.upper():
                return v.strip().strip('"').strip("'")
    return None


def resolve_key() -> str | None:
    return (
        os.environ.get('OLLAMA_API_KEY')
        or os.environ.get('OLLAMA_CLOUD_API_KEY')
        or _read_key_file(os.environ.get('OLLAMA_ENV_FILE', ''))
        or _read_key_file(_FALLBACK_KEY_PATH)
    )


class HostedEngine:
    """One instance per model id, e.g. HostedEngine('gemma4:31b')."""

    def __init__(self, model: str):
        self.model = model
        self.name = f'hosted:{model}'

    def available(self):
        if resolve_key() is None:
            return False, 'no OLLAMA_API_KEY / OLLAMA_ENV_FILE key found'
        return True, ''

    def run(self, page_paths: list[str], prompt: str, timeout: int = 240) -> EngineResult:
        key = resolve_key()
        if key is None:
            raise RuntimeError('resolve_key() returned None after available() said True — race?')

        content = [{'type': 'text', 'text': prompt}]
        for p in page_paths:
            b64 = base64.b64encode(open(p, 'rb').read()).decode()
            content.append({'type': 'image_url', 'image_url': {'url': f'data:image/png;base64,{b64}'}})

        body = json.dumps({
            'model': self.model,
            'messages': [{'role': 'user', 'content': content}],
            'temperature': 0,
            'max_tokens': 3000,
        }).encode()
        req = urllib.request.Request(
            'https://ollama.com/v1/chat/completions',
            data=body,
            headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'},
        )
        t0 = time.time()
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                data = json.load(r)
        except urllib.error.HTTPError as e:
            body_text = e.read().decode(errors='replace')[:200]
            raise RuntimeError(f'HTTP {e.code}: {body_text}') from None
        secs = time.time() - t0

        text = data['choices'][0]['message']['content']
        usage = data.get('usage', {})
        parsed = _parse_json(text)
        return EngineResult(text=text, parsed=parsed, seconds=secs, extra={
            'completion_tokens': usage.get('completion_tokens'),
            'total_tokens': usage.get('total_tokens'),
        })


def _parse_json(text: str):
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
