-- Coverage-period tracking for fee_payments. Decouples WHEN money was
-- collected (payment_date) from WHAT period it pays for. Previously
-- payment_date did double duty for both, so a late/backdated payment could
-- silently shift what period it appeared to cover.
--
-- coverage_start/coverage_end are the source of truth for the period a
-- recurring-dues payment covers, set explicitly by staff (Current Period /
-- Next Period / Custom Period), never inferred from payment_date. Follows
-- the established first-row-only convention (like balance_due/commission_*/
-- package_breakdown): when a payment is split across multiple methods (one
-- row per method sharing one receipt_no), only the FIRST row carries real
-- values. NULL for admission/other rows and every historical row predating
-- this column — receipts/reports fall back to the existing month_covered
-- column (unchanged, still written) or payment_date for those.
--
-- months_covered is informational/display only now — how many cycles
-- coverage_start..coverage_end spans, for the "N months" preset UI and
-- badge, without staff having to read two dates to see it was an advance
-- payment. describeCoveredPeriod() in src/lib/utils.ts treats NULL the
-- same as 1, so this changes no existing payment's displayed behavior.
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS coverage_start DATE;
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS coverage_end DATE;
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS months_covered INTEGER
  CHECK (months_covered IS NULL OR months_covered >= 1);
