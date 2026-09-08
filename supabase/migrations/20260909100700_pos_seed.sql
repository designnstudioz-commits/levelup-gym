-- Phase 3 / Stage A — seed data: the four departments and default
-- operational settings.
--
-- Idempotent: safe to re-run. Departments key on their slug, settings on
-- their key, and both use ON CONFLICT DO NOTHING so re-running never
-- overwrites a value an owner has since changed in the UI.

-- ── The four departments (spec §4) ────────────────────────────────────
--
-- Supplements, Level Up Cafe and Accessories are Level Up's own business
-- sections and take 100% of their revenue. HealthBox is the third-party
-- operator settled under the 50/50 net-profit model.
INSERT INTO public.pos_departments (name, slug, financial_owner, description, sort_order)
VALUES
  ('Supplements',   'supplements',   'levelup',
   'Protein, whey, isolate, mass gainer, BCAA/EAA, pre-workout, creatine, vitamins, omega', 1),
  ('Level Up Cafe', 'levelup-cafe',  'levelup',
   'Gatorade, Nibl protein bars, Nibl power bars, Booster, PowerFull, water bottles', 2),
  ('Accessories',   'accessories',   'levelup',
   'Shakers, bottles, gloves, straps, wrist wraps, towels, belts, resistance bands', 3),
  ('HealthBox',     'healthbox',     'healthbox',
   'Third-party food and drinks: burrito bowls, salads, sandwiches, wraps, quesadillas, shakes', 4)
ON CONFLICT (slug) DO NOTHING;

-- ── Default settings ─────────────────────────────────────────────────
--
-- Values live in the database precisely so changing operational policy
-- needs no migration and no deploy.
INSERT INTO public.pos_settings (key, value, description)
VALUES
  -- Spec §22: monthly is the default; the cycle stays configurable.
  ('settlement_period_type', '"monthly"'::jsonb,
   'HealthBox settlement cycle: weekly or monthly.'),

  -- Calendar month by default. A fixed day-of-month cycle can be set here
  -- later without a schema change.
  ('settlement_month_start_day', '1'::jsonb,
   'Day of month a monthly settlement period begins. 1 = calendar month.'),

  -- Above this, a discount needs a manager PIN at the terminal and creates
  -- a pos_approvals row of type discount_over_limit.
  ('cashier_discount_limit_percent', '10'::jsonb,
   'Maximum discount percent a cashier may apply without manager approval.'),

  -- How long after completion an order may still be voided. Beyond this it
  -- must be refunded instead, so the original sale stays on the shift.
  ('void_window_minutes', '120'::jsonb,
   'Minutes after completion during which a completed order may be voided.'),

  -- Barcode scanning is OFF until hardware is installed. No scanner is
  -- required for Phase 3 and the POS must never depend on one; a USB POS
  -- scanner presents as a keyboard, so enabling this later is a settings
  -- change, not a build.
  ('barcode_scanning_enabled', 'false'::jsonb,
   'Show the Scan barcode control on the terminal. Requires USB scanner hardware.'),

  -- Quick-cash denominations on the Cash payment screen, alongside the
  -- numeric keypad.
  ('quick_cash_denominations', '[500, 1000, 5000]'::jsonb,
   'Quick-cash buttons on the cash payment sheet, in PKR. "Exact" is always shown.'),

  ('low_stock_default_threshold', '5'::jsonb,
   'Default low-stock threshold applied to new inventory-tracked products.')
ON CONFLICT (key) DO NOTHING;
