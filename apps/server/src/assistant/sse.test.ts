import { describe, expect, it } from 'vitest';

import { openSse, sendJson } from './sse.js';
import { fakeResponse } from './test-support.js';

describe('SSE writer', () => {
  it('sets the stream headers and flushes them at once', () => {
    const res = fakeResponse();
    openSse(res);
    expect(res.status).toBe(200);
    expect(res.head?.['Content-Type']).toBe('text/event-stream; charset=utf-8');
    expect(res.head?.['Cache-Control']).toBe('no-store');
    expect(res.head?.['X-Accel-Buffering']).toBe('no');
    expect(res.flushed).toBe(true);
  });

  it('frames each event as exactly one data line, even with newlines in the payload', () => {
    const res = fakeResponse();
    const sse = openSse(res);
    expect(sse.send('delta', { t: 'line one\nline two "q"' })).toBe(true);
    const frame = res.chunks[0] ?? '';
    expect(frame).toMatch(/^event: delta\ndata: \{.*\}\n\n$/);
    expect(frame.split('\n').filter((l) => l.startsWith('data:'))).toHaveLength(1);
    expect(JSON.parse(frame.split('\n')[1]?.slice(6) ?? '')).toEqual({ t: 'line one\nline two "q"' });
  });

  it('writes comments for the keep-alive ping, on one line', () => {
    const res = fakeResponse();
    const sse = openSse(res);
    sse.comment('ping');
    sse.comment('a\nb');
    expect(res.chunks).toEqual([': ping\n\n', ': a b\n\n']);
  });

  it('ignores writes after close, and closes once', () => {
    const res = fakeResponse();
    const sse = openSse(res);
    sse.send('meta', { id: 'x' });
    sse.close();
    expect(sse.closed).toBe(true);
    expect(res.writableEnded).toBe(true);
    expect(sse.send('delta', { t: 'late' })).toBe(false);
    expect(sse.comment()).toBe(false);
    expect(res.chunks).toHaveLength(1);
    sse.close();
  });

  it('stops writing when the visitor disconnects', () => {
    const res = fakeResponse();
    const sse = openSse(res);
    res.disconnect();
    expect(sse.closed).toBe(true);
    expect(sse.send('delta', { t: 'x' })).toBe(false);
    expect(res.chunks).toHaveLength(0);
  });

  it('sendJson writes a no-store JSON answer', () => {
    const res = fakeResponse();
    sendJson(res, 400, { error: 'bad_request' });
    expect(res.status).toBe(400);
    expect(res.head?.['Cache-Control']).toBe('no-store');
    expect(JSON.parse(res.body)).toEqual({ error: 'bad_request' });
  });
});
