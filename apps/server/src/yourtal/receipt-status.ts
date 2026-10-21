import { receiptStatus, type YourtalPartnerClient } from './client.js';
import type { YourtalRegion } from './links.repo.js';

/**
 * Whether YourTal is paying points for receipts right now (F127: Snap Apps'
 * receipt package may be used up), held in this API process's memory.
 *
 * Not needed for correctness: a receipt refused while paused is refused by
 * YourTal's ledger whatever this says. So it is read at most once per
 * `ttlMs` per region, and every failure is soft ("unknown"), never an error.
 * A failed read is remembered for a shorter time, so a YourTal that is down
 * costs one short request per `failureTtlMs`, not one per page view.
 */

export type ReceiptPointsReading = {
  state: 'earning' | 'paused' | 'unknown';
  pointsPerReceipt: number | null;
  /** When YourTal was asked (epoch ms). */
  fetchedAt: number;
};

export class ReceiptStatusCache {
  private readonly entries = new Map<string, { reading: ReceiptPointsReading; expires: number }>();
  private readonly inFlight = new Map<string, Promise<ReceiptPointsReading>>();

  constructor(
    private readonly ttlMs = 5 * 60_000,
    private readonly failureTtlMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {}

  clear(): void {
    this.entries.clear();
  }

  async read(client: YourtalPartnerClient, region: YourtalRegion): Promise<ReceiptPointsReading> {
    // Keyed by partner too: a status is about one partner's package.
    const key = `${client.partnerId}:${region}`;
    const hit = this.entries.get(key);
    if (hit && hit.expires > this.now()) return hit.reading;

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const fetching = this.fetch(client, region).then((reading) => {
      const ttl = reading.state === 'unknown' ? this.failureTtlMs : this.ttlMs;
      this.entries.set(key, { reading, expires: this.now() + ttl });
      return reading;
    });
    this.inFlight.set(key, fetching);
    try {
      return await fetching;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async fetch(client: YourtalPartnerClient, region: YourtalRegion): Promise<ReceiptPointsReading> {
    const fetchedAt = this.now();
    try {
      const answer = await receiptStatus(client, region);
      if (!answer) return { state: 'unknown', pointsPerReceipt: null, fetchedAt };
      return {
        state: answer.earning ? 'earning' : 'paused',
        pointsPerReceipt: answer.pointsPerReceipt,
        fetchedAt,
      };
    } catch {
      return { state: 'unknown', pointsPerReceipt: null, fetchedAt };
    }
  }
}

/** The process-wide cache the controller uses. */
export const receiptStatusCache = new ReceiptStatusCache();
