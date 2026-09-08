-- Phase 3 / Stage A — register sessions, orders, order lines and payments.
--
-- NO RLS IN THIS FILE (see 20260909100000 header).
--
-- CRITICAL SEPARATION (spec §23): none of this touches fee_payments.
-- Membership finance and POS finance are different accounting domains and
-- are combined only at the reporting layer. fee_payments carries the
-- split-payment convention (multiple rows sharing one receipt_no, with
-- balance_due / commission_* / months_covered / package_breakdown set on the
-- FIRST row only) that every existing report and trainer-commission
-- calculation depends on. Nothing below writes to it.

-- ── Register sessions ────────────────────────────────────────────────
--
-- The reconciliation rule is printed on the approved Cashier & Shift Report
-- frame and is implemented exactly as stated:
--
--     opening_cash + cash sales - cash refunds = expected_cash
--
-- Payouts are deliberately NOT part of this formula. No payout feature
-- exists in Phase 3; if one is introduced later it gets its own column and
-- its own explicit addition to the formula.
CREATE TABLE IF NOT EXISTS public.pos_register_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One terminal today, but named from the start so a second counter needs
  -- no migration.
  terminal_name TEXT DEFAULT 'Main Counter',
  cashier_id    UUID NOT NULL REFERENCES public.system_users(id),

  opened_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opening_cash  NUMERIC(10,2) NOT NULL DEFAULT 0,

  closed_at     TIMESTAMPTZ,
  -- What the cashier physically counted in the drawer at close.
  counted_cash  NUMERIC(10,2),
  -- Computed at close from the formula above and then frozen. Stored rather
  -- than derived on read so a later refund or correction can never silently
  -- rewrite a shift that has already been reconciled.
  expected_cash NUMERIC(10,2),
  variance      NUMERIC(10,2),
  order_count   INT DEFAULT 0,
  -- { "Cash": 36500, "Card": 7800, ... } — the per-shift Payment Mix panel.
  payment_method_totals JSONB DEFAULT '{}'::jsonb,

  -- Manager review. Once reviewed the session is immutable: the approved
  -- frame states "keeps the session immutable after manager review".
  -- Correcting a reviewed session is an explicit audited workflow, not an
  -- edit — is_locked is never flipped back by ordinary application code.
  reviewed_by   UUID REFERENCES public.system_users(id),
  reviewed_at   TIMESTAMPTZ,
  is_locked     BOOLEAN NOT NULL DEFAULT FALSE,

  status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'closed', 'reviewed')),
  note          TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pos_sessions_cashier
  ON public.pos_register_sessions(cashier_id) WHERE deleted_at IS NULL;
-- A cashier may hold at most one open session at a time; enforcing it here
-- rather than in application code removes a whole class of double-shift bug.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pos_session_one_open_per_cashier
  ON public.pos_register_sessions(cashier_id)
  WHERE status = 'open' AND deleted_at IS NULL;

-- ── Orders ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pos_orders (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Customer-facing running number, e.g. 'LU-1042'. Deliberately NOT
  -- date-derived (Phase 3 decision). NULL while an order is open or held —
  -- a number is only issued at completion, so parked baskets never consume
  -- one. Held orders carry hold_ref instead, e.g. 'H-021', and receive a
  -- normal LU number when they are finally completed.
  order_no   TEXT UNIQUE,
  hold_ref   TEXT UNIQUE,

  session_id UUID REFERENCES public.pos_register_sessions(id),

  status     TEXT NOT NULL DEFAULT 'open'
               CHECK (status IN ('open', 'held', 'completed', 'voided',
                                 'refunded', 'partially_refunded')),

  -- Walk-in is the default; member association is optional (spec §5).
  customer_type   TEXT NOT NULL DEFAULT 'walk_in'
                    CHECK (customer_type IN ('walk_in', 'member', 'daily_member', 'staff')),
  member_id       UUID REFERENCES public.members(id),
  daily_member_id UUID REFERENCES public.daily_members(id),
  staff_id        UUID REFERENCES public.staff_members(id),
  customer_label  TEXT,

  -- Money. Every figure is a snapshot frozen at completion and is never
  -- recomputed from the current catalogue (spec §24).
  gross_amount    NUMERIC(10,2) NOT NULL DEFAULT 0,
  discount_type   TEXT CHECK (discount_type IN ('none', 'percent', 'amount')),
  discount_value  NUMERIC(10,2) DEFAULT 0,
  discount_amount NUMERIC(10,2) DEFAULT 0,
  net_amount      NUMERIC(10,2) NOT NULL DEFAULT 0,
  item_count      INT DEFAULT 0,

  -- Denormalised per-owner split of net_amount, written once at completion.
  -- Settlement and the owner dashboard both aggregate by owner over wide
  -- date ranges; without these, every such report would join and group over
  -- every line of every order. Derived from the lines, never edited.
  levelup_net_amount   NUMERIC(10,2) NOT NULL DEFAULT 0,
  healthbox_net_amount NUMERIC(10,2) NOT NULL DEFAULT 0,

  served_by    UUID NOT NULL REFERENCES public.system_users(id),
  completed_at TIMESTAMPTZ,

  -- Void preserves the record entirely — status flips, rows stay. Refund
  -- creates a NEW order carrying negative quantities, linked back through
  -- refund_of_order_id, so the ledger nets out and history stays intact.
  voided_by    UUID REFERENCES public.system_users(id),
  voided_at    TIMESTAMPTZ,
  void_reason  TEXT,
  refund_of_order_id     UUID REFERENCES public.pos_orders(id),
  discount_authorised_by UUID REFERENCES public.system_users(id),

  held_at      TIMESTAMPTZ,
  held_label   TEXT,
  note         TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pos_orders_session
  ON public.pos_orders(session_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pos_orders_member
  ON public.pos_orders(member_id) WHERE member_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pos_orders_completed
  ON public.pos_orders(completed_at) WHERE status = 'completed' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pos_orders_status
  ON public.pos_orders(status) WHERE deleted_at IS NULL;

-- ── Order lines ──────────────────────────────────────────────────────
--
-- Immutable: no deleted_at, matching attendances and activity_logs.
--
-- Everything from department_id downward is a SNAPSHOT taken at the moment
-- of sale, not a join. Prices change, products get renamed, and a product
-- can be moved between departments — but a settlement report re-run in
-- December for August must reproduce August exactly. financial_owner in
-- particular is required at line level by spec §21 so a mixed basket
-- remains attributable.
CREATE TABLE IF NOT EXISTS public.pos_order_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   UUID NOT NULL REFERENCES public.pos_orders(id),
  product_id UUID REFERENCES public.pos_products(id),
  variant_id UUID REFERENCES public.pos_product_variants(id),

  department_id   UUID REFERENCES public.pos_departments(id),
  department_name TEXT NOT NULL,
  financial_owner TEXT NOT NULL CHECK (financial_owner IN ('levelup', 'healthbox')),

  product_name TEXT NOT NULL,
  variant_name TEXT,
  brand        TEXT,
  sku          TEXT,

  unit_price NUMERIC(10,2) NOT NULL,
  cost_price NUMERIC(10,2),
  qty        NUMERIC(10,2) NOT NULL,   -- negative on a refund line

  -- [{ "group": "Sauce", "name": "Dynamic", "price_delta": 0 }, ...]
  modifiers       JSONB DEFAULT '[]'::jsonb,
  modifiers_total NUMERIC(10,2) DEFAULT 0,
  -- The "Special note" field on the Customize screen — a kitchen note for
  -- this line only, distinct from the order-level note.
  item_note       TEXT,

  line_gross    NUMERIC(10,2) NOT NULL DEFAULT 0,
  line_discount NUMERIC(10,2) NOT NULL DEFAULT 0,
  line_net      NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Which member-pricing rule actually fired, recorded so a historical
  -- receipt can be explained without consulting today's catalogue.
  member_price_applied BOOLEAN DEFAULT FALSE,
  member_price_type    TEXT CHECK (member_price_type IN ('none', 'fixed', 'percent')),
  member_price_value   NUMERIC(10,2),

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_order_items_order
  ON public.pos_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_pos_order_items_owner
  ON public.pos_order_items(financial_owner, created_at);
CREATE INDEX IF NOT EXISTS idx_pos_order_items_department
  ON public.pos_order_items(department_id, created_at);

-- ── Payments ─────────────────────────────────────────────────────────
--
-- One row per method. A split payment is several rows against one order —
-- the same shape as the gym's fee_payments convention, deliberately, so the
-- two are reasoned about the same way.
--
-- Method list is spec §10 exactly. Note 'Bank Transfer' here versus the
-- gym's existing 'Bank' in fee_payments: the gym's value is a stored CHECK
-- value across historical rows and must not be renamed, so POS carries its
-- own constant rather than reusing PAYMENT_METHODS from PaymentSplitRows.
--
-- Member Account / tab is NOT a POS payment method in Phase 3.
--
-- Immutable: no deleted_at. A reversal is a new negative row.
CREATE TABLE IF NOT EXISTS public.pos_payments (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.pos_orders(id),
  method   TEXT NOT NULL
             CHECK (method IN ('Cash', 'Card', 'Bank Transfer', 'EasyPaisa', 'JazzCash')),
  amount   NUMERIC(10,2) NOT NULL,
  -- Cash only: what the customer handed over, and what came back.
  tendered     NUMERIC(10,2),
  change_given NUMERIC(10,2),
  -- Wallet transaction id, card last four, bank transfer reference.
  reference    TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_payments_order
  ON public.pos_payments(order_id);
CREATE INDEX IF NOT EXISTS idx_pos_payments_method
  ON public.pos_payments(method, created_at);
