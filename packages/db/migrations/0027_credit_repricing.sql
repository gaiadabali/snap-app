-- 0027_credit_repricing
-- Credits are the whole commercial model now, and they are priced off cost.
--
-- ── What changed in the product ─────────────────────────────────────────────
--
-- Subscriptions are gone. There are no monthly tiers, no seat licences and no
-- plan to be on: a new account gets ten free scans, and after that one scan
-- costs one credit. Migration 0008's `plans` / `subscriptions` tables are left
-- in place deliberately — "no subscriptions" in product terms does not mean
-- "drop the tables", and entitlement still flows through
-- `v_tenant_entitlement` while the app stops surfacing a plan. Removing them is
-- a separate decision with real consequences, and it is not this migration's.
--
-- ── The pricing rule, so nobody has to re-derive it ─────────────────────────
--
-- Settled by the owner 2026-09-17:
--
--     price per scan = cost of one real model scan × 3
--
-- `docs/MONETISATION.md` §5 measures that cost: extraction is ~$0.011/scan
-- blended (Haiku 4.5 primary, Sonnet 5 escalation). So:
--
--     $0.011 × 3 = $0.033 per credit
--
-- and every pack below is simply that rate times its size. Flat, not a ladder:
-- the rule names one per-scan price, so a volume discount would contradict it.
-- The previous seed DID taper — $0.015/credit at 10 down to $0.010 at 1000 —
-- and that taper is what this removes. If a discount is wanted back, change it
-- here rather than in the UI, which reads these figures and computes nothing.
--
-- Note the direction: every pack gets MORE expensive. The old prices were
-- below cost×3 at every size, and at 1000 credits the old $10.00 was below the
-- ~$11.00 the inference alone costs — that pack lost money on every sale.
--
-- ── One thing the owner should know, flagged not fixed ──────────────────────
--
-- At $0.033/scan the smallest pack sells for $0.33. Australian card processing
-- is roughly 1.75% + $0.30 per transaction, so a $0.33 sale nets about $0.02
-- and a $1.65 sale about $1.32. The 10-pack cannot pay for its own processing
-- and the 50-pack barely does. That is a pricing decision rather than a schema
-- one, so the packs are repriced exactly as instructed and left active; the
-- options are a minimum purchase, a wallet top-up model, or dropping the two
-- smallest packs. Whoever picks: `active = false` retires a pack without
-- deleting it, and existing purchase records keep the price they captured.
--
-- Prices are GST-inclusive AUD, matching the consumer convention used for
-- `plans.price_cents` in 0008.

UPDATE credit_packs SET price_aud = 0.3300  WHERE code = 'credits_10';
UPDATE credit_packs SET price_aud = 1.6500  WHERE code = 'credits_50';
UPDATE credit_packs SET price_aud = 3.3000  WHERE code = 'credits_100';
UPDATE credit_packs SET price_aud = 6.6000  WHERE code = 'credits_200';
UPDATE credit_packs SET price_aud = 16.5000 WHERE code = 'credits_500';
UPDATE credit_packs SET price_aud = 33.0000 WHERE code = 'credits_1000';

-- The rule is arithmetic, so it can be asserted rather than trusted. If a
-- later edit breaks the relationship this fails the migration instead of
-- quietly shipping a pack priced off a number nobody meant.
DO $$
DECLARE
  rate numeric := 0.0330;  -- $0.011 model cost × 3
  bad  text;
BEGIN
  SELECT string_agg(code || ' is ' || price_aud || ', expected ' || (credits * rate), '; ')
    INTO bad
    FROM credit_packs
   WHERE active
     AND price_aud <> round(credits * rate, 4);

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'credit_packs no longer priced at cost x 3: %', bad;
  END IF;
END $$;
