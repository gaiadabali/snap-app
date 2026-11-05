-- 0051_credit_packs_ten_cents
-- About 10c a scan: packs of 50 / 100 / 250 for A$5 / 10 / 25, GST-inclusive.
--
-- Founder, 2026-10-20 (group plan 0.11.a). The old rule, price = model cost x 3
-- on a $0.011 base, rested on Claude Haiku and Sonnet. Production reads with
-- Gemma 4 31B: A$0.0005 a page, about A$0.0027 a scan with five years of
-- storage. At 3.7c a credit that left a ~90% margin and nothing for the points
-- paid to YourTal; 10c is the founder's price, checked per scan on the A$5 pack:
--
--     price, GST-inclusive                       10.00c
--     GST (1/11)                                 -0.91c   -> 9.09c
--     Stripe 1.75% + 30c, over 50 scans          -0.77c
--     read + store (measured 0.27c, 0.5c kept)   -0.50c
--     1 YourTal point at cost                    -3.00c
--                                                ~ 4.8c profit (53%)
--
-- Nothing smaller than A$5: Stripe's fixed 30c is a third of an A$1 pack.
--
-- The old 200 / 500 / 1000 packs are retired, not deleted: `credit_purchases`
-- references `credit_packs(code)` and old receipts must keep resolving.
-- `listCreditPacks` filters on `active`, so they leave sale but not the record.
-- 0027 and 0029 are untouched; purchases keep the price they captured.

UPDATE credit_packs SET active = false WHERE code IN ('credits_200', 'credits_500', 'credits_1000');

UPDATE credit_packs SET price_aud = 5.0000,  sort_order = 20 WHERE code = 'credits_50';
UPDATE credit_packs SET price_aud = 10.0000, sort_order = 30 WHERE code = 'credits_100';

INSERT INTO credit_packs (code, credits, price_aud, sort_order)
VALUES ('credits_250', 250, 25.0000, 40);

DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(code || ' is ' || price_aud, '; ') INTO bad
    FROM credit_packs
   WHERE active AND price_aud <> round(credits * 0.10, 4);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'active credit_packs are not at 10c a scan: %', bad;
  END IF;
  IF (SELECT array_agg(credits ORDER BY credits) FROM credit_packs WHERE active) <> ARRAY[50, 100, 250] THEN
    RAISE EXCEPTION 'active credit_packs must be exactly 50, 100 and 250';
  END IF;
END $$;
