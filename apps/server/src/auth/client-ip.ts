/**
 * The caller's address, for per-IP rate limits.
 *
 * Fastify's `request.ip`. What that means depends on `trustProxy` in
 * `main.ts`: the API is only reachable through nginx on the same host (the
 * compose file publishes it on 127.0.0.1) or from the web container, so the
 * proxy hops are private addresses and `request.ip` is the first address
 * before them — the real client, which no client can forge, because the walk
 * starts from the socket and stops at the first hop that is not trusted.
 *
 * `unknown` when absent (a unit test calling a handler directly). Everything
 * keyed on `unknown` shares one bucket, which errs towards refusing.
 */
export type IpAwareRequest = { ip?: string };

export function clientIp(request: IpAwareRequest | undefined): string {
  return request?.ip || 'unknown';
}
