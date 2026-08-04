-- Registration's "Package Payment" section now supports an independent
-- discount per selected package instead of one discount over the summed
-- total. A single free-text `note` (parsed by receipt-page regex
-- parseDiscount()) can't represent N independent discounts, so this adds a
-- structured column instead. Set ONLY on the first row of the payment's
-- payment-method-split batch (same convention as balance_due/
-- balance_due_date) — every other row in the group leaves it NULL.
-- Historical rows (pre-dating this column) are NULL; receipt pages fall
-- back to the existing parseDiscount()-on-note behavior for those.
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS package_breakdown JSONB;

-- Shape: [{ name, original, discount_type, discount_value, discount_amount, final }, ...]
