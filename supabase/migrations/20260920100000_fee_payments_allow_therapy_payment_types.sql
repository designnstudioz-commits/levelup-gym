-- Converge fee_payments.payment_type with the intended business rule.
--
-- Drift found 2026-09-20 by the first staging schema-parity run. Production
-- allowed six values; every migration in this folder only ever defined four.
-- The two extras — 'nutritionist' and 'physiotherapy' — were added to the
-- live database by hand and never captured here, so a rebuild from
-- migrations produced a database that REJECTS payments production accepts.
--
-- Production behaviour is the intended one (the UI and commission logic both
-- use these types), so this migration widens the constraint rather than
-- narrowing production. It is a no-op against production, where the wider
-- constraint already exists, and the real fix for staging and any future
-- rebuild.
ALTER TABLE fee_payments DROP CONSTRAINT IF EXISTS fee_payments_payment_type_check;

ALTER TABLE fee_payments ADD CONSTRAINT fee_payments_payment_type_check
  CHECK (payment_type = ANY (ARRAY[
    'membership'::text,
    'trainer'::text,
    'admission'::text,
    'nutritionist'::text,
    'physiotherapy'::text,
    'other'::text
  ]));
