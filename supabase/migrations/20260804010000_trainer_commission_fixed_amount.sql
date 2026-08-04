-- Adds a "Fixed Amount" commission mode alongside the existing Percentage
-- mode on trainer_member_commissions. commission_percent stays NOT NULL
-- (unchanged) — when commission_type = 'fixed', callers write 0 into it
-- (unused placeholder) rather than relaxing the existing constraint.
ALTER TABLE trainer_member_commissions
  ADD COLUMN IF NOT EXISTS commission_type TEXT NOT NULL DEFAULT 'percent'
    CHECK (commission_type IN ('percent', 'fixed'));

ALTER TABLE trainer_member_commissions
  ADD COLUMN IF NOT EXISTS commission_amount NUMERIC(10,2);

-- Verify after running:
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conname LIKE 'trainer_member_commissions%';
