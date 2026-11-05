-- 0053 — a refunded credit purchase keeps when it was paid (group task 7.5.a).
--
-- 0024's `purchase_paid_has_time` tied `paid_at` to `status = 'paid'` exactly,
-- so the refund the Stripe webhook now records (`charge.refunded`, which takes
-- the grant's remaining credits back) would have had to erase the payment
-- time. A refund is of a payment, so it keeps it. Nothing set `refunded`
-- before this, so no existing row breaks the new check.
-- Reverse: set paid_at = NULL on refunded rows, then restore 0024's
-- CHECK ((status = 'paid') = (paid_at IS NOT NULL)).

ALTER TABLE credit_purchases DROP CONSTRAINT purchase_paid_has_time;
ALTER TABLE credit_purchases ADD CONSTRAINT purchase_paid_has_time
  CHECK ((status IN ('paid', 'refunded')) = (paid_at IS NOT NULL));
