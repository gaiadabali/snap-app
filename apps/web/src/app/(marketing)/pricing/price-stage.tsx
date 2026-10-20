import { Reveal } from '@/design/site';

import { FREE_SCANS_AT_SIGNUP } from './credit-packs';
import { CENTS_PER_SCAN } from './figures';

/**
 * How many slots the strip draws after the free ones. Pure decoration: the
 * paid run fades off the edge because there is no last scan.
 */
const PAID_SLOTS = 4;

/**
 * The hero's price, as the picture. One figure — the per-scan rate, derived —
 * and under it the shape of the model: the free scans, then one credit each.
 *
 * The strip is `aria-hidden`; its caption is the real text. The scan line that
 * crosses the figure plays once when the stage is first seen (pricing.css).
 */
export function PriceStage() {
  const free = Array.from({ length: FREE_SCANS_AT_SIGNUP }, (_, i) => i);
  const paid = Array.from({ length: PAID_SLOTS }, (_, i) => i + FREE_SCANS_AT_SIGNUP);

  return (
    <Reveal variant="scale" className="price-stage">
      <span className="price-beam" aria-hidden />

      <p className="price-over">After your {FREE_SCANS_AT_SIGNUP} free scans</p>

      <p className="price-figure">
        <span className="price-figure-n ink-grad">{CENTS_PER_SCAN}</span>
        <span className="price-figure-c">¢</span>
      </p>
      <p className="price-per">a scan</p>
      <p className="small mt-1">GST and card fees already in it.</p>

      <div className="mt-9" aria-hidden>
        <div className="price-strip">
          <div className="price-group" data-kind="free" style={{ flex: FREE_SCANS_AT_SIGNUP }}>
            <div className="price-slots">
              {free.map((i) => (
                <span key={i} className="price-slot" data-kind="free" style={{ ['--i' as string]: i }} />
              ))}
            </div>
            <span className="price-group-label">Free</span>
          </div>
          <div className="price-group" data-kind="paid" style={{ flex: PAID_SLOTS }}>
            <div className="price-slots">
              {paid.map((i) => (
                <span key={i} className="price-slot" data-kind="paid" style={{ ['--i' as string]: i }} />
              ))}
            </div>
            <span className="price-group-label">{CENTS_PER_SCAN}¢ each</span>
          </div>
        </div>
      </div>

      <p className="small mt-4">
        Scans 1 to {FREE_SCANS_AT_SIGNUP} are free, no card. After that, one credit a scan.
      </p>
    </Reveal>
  );
}
