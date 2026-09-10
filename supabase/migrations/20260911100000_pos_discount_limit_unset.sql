-- Phase 3C — removes an invented default before building the enforcement
-- that would have made it real.
--
-- Phase A seeded pos_settings.cashier_discount_limit_percent = 10 with the
-- description "Maximum discount percent a cashier may apply without
-- manager approval" — but nothing ever enforced it, so it sat inert. Now
-- that Phase C actually builds that enforcement (the discount-over-limit
-- approval flow), leaving 10 in place would mean the enforcement's very
-- first act is applying a number nobody at Level Up ever agreed to. That
-- is exactly the "invented threshold" the instruction says not to ship.
--
-- Set to JSON null, not deleted: the row, its key and its description stay
-- as documentation of what the setting DOES. A null value means "not
-- configured," and the discount-limit code treats that as "preserve
-- current behaviour" — no gate, no approval required, matching how the
-- gym's own existing fee-discount flow already works (no cap of any kind).
--
-- The owner sets a real number here (or via a future settings screen)
-- when they decide there should be one.
UPDATE public.pos_settings
SET value = 'null'::jsonb, updated_at = now()
WHERE key = 'cashier_discount_limit_percent';
