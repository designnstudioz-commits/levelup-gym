-- Add commission tracking columns to fee_payments
-- These are used when collecting trainer/nutritionist/physiotherapy fees
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS commission_staff_id UUID REFERENCES staff_members(id);
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS commission_rate     NUMERIC(5,2);
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS commission_amount   NUMERIC(10,2);
