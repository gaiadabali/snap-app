-- 0029_credit_all_in_pricing
-- Retire the 10-pack, and make the displayed price the whole price.
--
-- ── 1. The 10-pack is gone ──────────────────────────────────────────────────
--
-- At 0027's $0.033/credit it sold for $0.33. Australian card processing is
-- roughly 1.75% + $0.30, so that sale netted about two cents against $0.11 of
-- inference — it LOST money on every purchase, and it was the only pack that
-- did: break-even sat at about fourteen credits. It also had no job, because a
-- new account already gets ten scans free.
--
-- `active = false` rather than DELETE. `credit_purchases.pack_code` is a
-- foreign key into this table and old receipts must keep resolving; a
-- customer's history should not develop a hole because a pack was withdrawn.
-- `listCreditPacks` already filters on `active`, so it disappears from sale
-- without disappearing from the record.
--
-- ── 2. One price, everything in it ──────────────────────────────────────────
--
-- Settled by the owner 2026-09-18: the customer sees a single number and that
-- number covers everything — the inference, the margin, GST, and the card fee.
-- No line items added at checkout, nothing that looks like a surprise.
--
-- So the price is grossed UP from what we need to retain, rather than having
-- costs subtracted from it afterwards:
--
--     retain per credit           = model cost x 3   = $0.011 x 3 = $0.0330
--     GST, on a GST-inclusive price, is 1/11 of it   = 9.0909%
--     card fee, proportional part                    = 1.75%
--
--     price = 0.0330 / (1 - 1/11 - 0.0175)
--           = 0.0330 / 0.891591
--           = $0.037012...  ->  $0.037 per credit
--
-- $0.037 is not a rounding of convenience: at 3.7 cents every pack size here
-- lands on an exact cent (50 -> $1.85, 1000 -> $37.00), so no pack needs a
-- fraction and no total needs explaining.
--
-- ── What is NOT in that formula, and why ────────────────────────────────────
--
-- The card fee's FIXED 30c component. It cannot be, while pricing stays flat:
-- a fixed cost per TRANSACTION divided across a variable number of scans is a
-- different per-scan price for every pack, which is the taper the owner
-- rejected. Absorbing it instead means the retained multiple climbs with pack
-- size — 2.45x at 50 credits, 2.97x at 1000 — rather than sitting exactly at
-- 3x everywhere. Flat pricing and an exact 3x on every pack cannot both be
-- true; flat was chosen.
--
-- ── GST: CONFIRM THIS BEFORE INVOICING ──────────────────────────────────────
--
-- These figures assume Snap Apps is registered for GST and that the price is
-- GST-inclusive, which is the convention 0008 and MONETISATION.md already use.
-- Registration is compulsory only above $75,000 turnover and optional below it.
--
-- If the business is NOT registered, it must not charge GST or state GST on an
-- invoice, and the gross-up above is wrong by 1/11 — the rate would be
-- 0.0330 / (1 - 0.0175) = $0.0336. Changing it is one number here and one in
-- `apps/web/src/app/(marketing)/pricing/credit-packs.ts`, which a test keeps
-- in agreement with this file.

UPDATE credit_packs SET active = false WHERE code = 'credits_10';

UPDATE credit_packs SET price_aud = 1.8500  WHERE code = 'credits_50';
UPDATE credit_packs SET price_aud = 3.7000  WHERE code = 'credits_100';
UPDATE credit_packs SET price_aud = 7.4000  WHERE code = 'credits_200';
UPDATE credit_packs SET price_aud = 18.5000 WHERE code = 'credits_500';
UPDATE credit_packs SET price_aud = 37.0000 WHERE code = 'credits_1000';

-- Asserted rather than trusted, same as 0027: if a later edit breaks the
-- relationship this fails the migration instead of shipping a price nobody
-- derived.
DO $$
DECLARE
  rate numeric := 0.0370;  -- ($0.011 x 3) grossed up for GST and the % fee
  bad  text;
BEGIN
  SELECT string_agg(code || ' is ' || price_aud || ', expected ' || round(credits * rate, 4), '; ')
    INTO bad
    FROM credit_packs
   WHERE active
     AND price_aud <> round(credits * rate, 4);

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'active credit_packs are not at the all-in rate: %', bad;
  END IF;

  IF EXISTS (SELECT 1 FROM credit_packs WHERE active AND credits < 14) THEN
    RAISE EXCEPTION
      'a pack below the ~14-credit break-even is on sale: it loses money on every purchase';
  END IF;
END $$;
