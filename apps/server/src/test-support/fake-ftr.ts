import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A stand-in for Free Tax Returns' `POST /api/yourtal/transfers` (4.8.a): it
 * records what it was sent (the assertion as given, the raw body bytes) and
 * answers as the test says. It opens no assertion: that is FTR's own test.
 */
export type FtrCall = { method: string; contentType: string | undefined; authorization: string | undefined; body: Buffer };

export type FakeFtr = {
  /** `http://127.0.0.1:<port>/api/yourtal/transfers` */
  url: string;
  calls: FtrCall[];
  /** The next answers, one per call; the last repeats. Default: 201 `{ importId: 'imp-1' }`. */
  answers: Array<{ status: number; body: Record<string, unknown> }>;
  /** Answer a redirect to this URL instead, with `redirectStatus`. */
  redirectTo: string | null;
  /** 307 by default; 303 makes a following client re-send as a bodiless GET (a 307 with a body fails inside undici). */
  redirectStatus: number;
  close(): Promise<void>;
};

export async function startFakeFtr(): Promise<FakeFtr> {
  const server: Server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const fake: FakeFtr = {
    url: `http://127.0.0.1:${port}/api/yourtal/transfers`,
    calls: [],
    answers: [{ status: 201, body: { importId: 'imp-1' } }],
    redirectTo: null,
    redirectStatus: 307,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
  server.on('request', (req: IncomingMessage, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const n = fake.calls.push({
        method: req.method ?? '',
        contentType: req.headers['content-type'],
        authorization: req.headers.authorization,
        body: Buffer.concat(chunks),
      });
      if (fake.redirectTo) {
        res.statusCode = fake.redirectStatus;
        res.setHeader('location', fake.redirectTo);
        return res.end();
      }
      const answer = fake.answers[Math.min(n, fake.answers.length) - 1]!;
      res.statusCode = answer.status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(answer.body));
    })();
  });
  return fake;
}
