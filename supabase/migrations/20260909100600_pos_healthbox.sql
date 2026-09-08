-- Phase 3 / Stage A — HealthBox expenses and settlement (spec §18, §19,
-- §20, §22).
--
-- NO RLS IN THIS FILE (see 20260909100000 header). Note that scoping
-- HealthBox staff away from Level Up financial data is a SECURITY control
-- and lands with the RLS change set, not here.
--
-- THE FINANCIAL MODEL, stated once so it is not re-derived incorrectly
-- elsewhere:
--
--     Net Sales (after customer discounts)
--   - Approved COGS
--   - Approved operating expenses
--   = Net Profit
--
--     Net Profit > 0  ->  50% HealthBox, 50% Level Up
--     Net Profit < 0  ->  100% HealthBox    (spec §20 — a loss is NOT shared)
--
-- This is PERIOD-level. There is deliberately no per-line commission
-- percentage anywhere in the POS schema. Line-level financial_owner on
-- pos_order_items is what makes the period aggregation possible.

-- ── HealthBox expenses ───────────────────────────────────────────────
--
-- A separate table rather than reusing the gym's `expenses`, because this
-- needs an approval workflow, proof attachments, a submitting party and a
-- settlement link — none of which `expenses` has — and because putting a
-- third party's financial records in the gym's own expense ledger runs
-- against the separation required by spec §23.
CREATE TABLE IF NOT EXISTS public.pos_healthbox_expenses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,

  -- COGS and operating expenses are reported as SEPARATE figures on the
  -- approved HealthBox Financials screen, so this cannot be free text.
  category TEXT NOT NULL CHECK (category IN ('cogs', 'salary', 'operating', 'other')),

  title       TEXT NOT NULL,
  description TEXT,
  amount      NUMERIC(10,2) NOT NULL,

  -- Proof/receipt images. Uploaded through an authenticated route; the
  -- bucket is separate from member-photos.
  attachment_urls TEXT[],

  -- Only 'approved' rows are included in a settlement calculation. Level Up
  -- management approves; HealthBox staff may submit but never approve.
  status TEXT NOT NULL DEFAULT 'pending'
           CHECK (status IN ('pending', 'approved', 'rejected')),

  -- Either party may enter an expense — the approved frame shows rows
  -- entered by both HealthBox and Level Up. The displayed "Entered By"
  -- party is derived from the submitter's role.
  submitted_by     UUID REFERENCES public.system_users(id),
  approved_by      UUID REFERENCES public.system_users(id),
  approved_at      TIMESTAMPTZ,
  rejection_reason TEXT,

  -- Set when a settlement is finalised, freezing this expense into that
  -- period so a later edit cannot retroactively change a settled figure.
  settlement_id UUID,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pos_hb_expenses_period
  ON public.pos_healthbox_expenses(expense_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pos_hb_expenses_status
  ON public.pos_healthbox_expenses(status) WHERE deleted_at IS NULL;

-- ── Settlements ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pos_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Only HealthBox settles today; the column exists so a second
  -- third-party owner needs no migration.
  financial_owner TEXT NOT NULL DEFAULT 'healthbox'
                    CHECK (financial_owner IN ('healthbox')),

  -- Configurable per spec §22 — monthly is the default, stored in
  -- pos_settings.settlement_period_type, and switching it requires no code
  -- change.
  period_type  TEXT NOT NULL DEFAULT 'monthly'
                 CHECK (period_type IN ('weekly', 'monthly')),
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,

  -- All snapshots, frozen at finalisation.
  gross_sales     NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_discounts NUMERIC(10,2) NOT NULL DEFAULT 0,
  net_sales       NUMERIC(10,2) NOT NULL DEFAULT 0,

  approved_cogs      NUMERIC(10,2) NOT NULL DEFAULT 0,
  approved_operating NUMERIC(10,2) NOT NULL DEFAULT 0,
  approved_expenses  NUMERIC(10,2) NOT NULL DEFAULT 0,

  net_profit NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Both shares are ZERO when the period is a loss. The loss belongs wholly
  -- to HealthBox (spec §20) and is carried in loss_amount, NOT split.
  levelup_share   NUMERIC(10,2) NOT NULL DEFAULT 0,
  healthbox_share NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_loss         BOOLEAN NOT NULL DEFAULT FALSE,
  loss_amount     NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- A settlement cannot be finalised while any expense in its period is
  -- still pending — the approved frame shows the status literally as
  -- "DRAFT — 3 PENDING EXPENSES". Enforced in the settlement service.
  status TEXT NOT NULL DEFAULT 'draft'
           CHECK (status IN ('draft', 'finalised', 'paid')),

  finalised_by   UUID REFERENCES public.system_users(id),
  finalised_at   TIMESTAMPTZ,
  paid_at        TIMESTAMPTZ,
  payment_method TEXT,
  note           TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pos_settlements_period
  ON public.pos_settlements(period_start, period_end) WHERE deleted_at IS NULL;

-- Deferred FK: expenses reference a settlement and settlements are created
-- afterwards, so the constraint is added once both tables exist.
ALTER TABLE public.pos_healthbox_expenses
  DROP CONSTRAINT IF EXISTS pos_hb_expenses_settlement_fk;
ALTER TABLE public.pos_healthbox_expenses
  ADD CONSTRAINT pos_hb_expenses_settlement_fk
  FOREIGN KEY (settlement_id) REFERENCES public.pos_settlements(id);
