-- Add receipt tracking to fee_payments
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS receipt_no   TEXT UNIQUE;
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS month_covered DATE;

-- Fast lookup for "unpaid this month" and receipt lookups
CREATE INDEX IF NOT EXISTS idx_fee_payments_date    ON fee_payments(payment_date)  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_fee_payments_receipt ON fee_payments(receipt_no)    WHERE deleted_at IS NULL;
