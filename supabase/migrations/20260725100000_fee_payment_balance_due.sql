-- Supports two related features: (1) splitting one fee collection across
-- multiple payment methods (e.g. Rs 20,000 cash + Rs 10,000 bank) as several
-- fee_payments rows sharing one receipt_no, and (2) partial payments — a
-- member pays part of what's due now and owes the rest by a specific date.
--
-- balance_due / balance_due_date only ever live on ONE row per logical
-- transaction (the first row of a split-method group) — every other row in
-- the group gets balance_due = 0, so SUM(balance_due) per member is never
-- double-counted. amount always means money actually collected; the
-- original full amount due is recoverable as amount + balance_due on that
-- first row. Member status is NOT affected by an outstanding balance — it
-- stays whatever it already was (active/inactive/frozen/archived); this is
-- purely a bookkeeping flag surfaced in the UI as a "Pending Fees" pill.
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS balance_due NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS balance_due_date DATE;

-- Splitting a payment across methods means one logical collection can now
-- produce multiple fee_payments rows sharing the same receipt_no, so it can
-- no longer be unique per row. The non-unique idx_fee_payments_receipt
-- index (added in 20260604000007_fee_receipts.sql) already covers the
-- "fetch every row for this receipt_no" lookup this feature needs, so it's
-- left in place — only the UNIQUE constraint itself is dropped.
ALTER TABLE fee_payments DROP CONSTRAINT IF EXISTS fee_payments_receipt_no_key;

CREATE INDEX IF NOT EXISTS idx_fee_payments_balance_due
  ON fee_payments(member_id, balance_due)
  WHERE deleted_at IS NULL AND balance_due > 0;
