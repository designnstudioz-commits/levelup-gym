-- Phase 3 / Stage A — the manager approval workflow (spec §13, §7 of the
-- Phase 3 decisions).
--
-- NO RLS IN THIS FILE (see 20260909100000 header).
--
-- Approved flow:
--     cashier initiates -> reason required -> approval request created
--     -> manager approves/rejects -> approved action posts an auditable
--        refund/void transaction
--
-- A cashier can SEE and START a refund or void (the approved Recent Orders
-- frame shows the Refund button in the cashier's own UI, under the banner
-- "Refunds and voids require manager approval"). A cashier can never
-- self-authorise one.
--
-- This is a table rather than a few columns on pos_orders because the
-- approved Cashier & Shift Report renders an "Exceptions & Approvals" panel
-- listing refunds, voids AND over-limit discounts side by side with their
-- statuses. Over-limit discounts happen on orders that are otherwise
-- perfectly normal, so there is no single order column that could produce
-- that list.
CREATE TABLE IF NOT EXISTS public.pos_approvals (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  type TEXT NOT NULL CHECK (type IN ('refund', 'void', 'discount_over_limit')),

  order_id   UUID REFERENCES public.pos_orders(id),
  session_id UUID REFERENCES public.pos_register_sessions(id),

  -- The money or percentage at stake, so the report can show a value
  -- column without re-deriving it from the order.
  value_amount  NUMERIC(10,2),
  value_percent NUMERIC(5,2),

  -- Mandatory on request. The UI enforces it; kept NOT NULL here so an
  -- unexplained approval request cannot be created by any path.
  reason TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'pending'
           CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),

  requested_by UUID NOT NULL REFERENCES public.system_users(id),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Set when a manager resolves the request, whether by PIN at the terminal
  -- or from the dashboard.
  resolved_by      UUID REFERENCES public.system_users(id),
  resolved_at      TIMESTAMPTZ,
  resolution_note  TEXT,

  -- For a refund: the negative order this approval produced. Lets the
  -- report jump from the approval to the resulting transaction.
  resulting_order_id UUID REFERENCES public.pos_orders(id),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pos_approvals_status
  ON public.pos_approvals(status, requested_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pos_approvals_order
  ON public.pos_approvals(order_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pos_approvals_session
  ON public.pos_approvals(session_id) WHERE deleted_at IS NULL;
