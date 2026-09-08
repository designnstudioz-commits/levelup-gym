-- Phase 3 / Stage A — inventory: stock receipts, the movement ledger,
-- and physical stock counts (spec §15).
--
-- NO RLS IN THIS FILE (see 20260909100000 header).
--
-- Governing rule, stated on both approved inventory frames: quantities are
-- NEVER overwritten. Every change is an immutable movement carrying a
-- reason. pos_products.stock_qty is a derived cache of SUM(qty_delta), not
-- the source of truth.

-- ── Stock receipts ───────────────────────────────────────────────────
--
-- The approved Receive Stock screen is a DOCUMENT: one supplier, one date,
-- one invoice reference, many product lines. A flat movement table cannot
-- express "these twelve movements were one delivery", which is what makes
-- a supplier invoice reconcilable. Hence a header table, with each line
-- emitting a 'purchase' movement that points back here.
CREATE TABLE IF NOT EXISTS public.pos_stock_receipts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id    UUID REFERENCES public.pos_suppliers(id),
  department_id  UUID REFERENCES public.pos_departments(id),
  received_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  reference      TEXT,                    -- supplier invoice / delivery note
  total_qty      NUMERIC(10,2) DEFAULT 0,
  total_cost     NUMERIC(10,2) DEFAULT 0,
  note           TEXT,
  -- Draft receipts can be edited; posting is what writes the movements and
  -- moves stock. A posted receipt is never edited — correct it with an
  -- adjustment, so the audit trail shows what actually happened.
  status         TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'posted')),
  posted_by      UUID REFERENCES public.system_users(id),
  posted_at      TIMESTAMPTZ,
  created_by     UUID REFERENCES public.system_users(id),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pos_stock_receipts_supplier
  ON public.pos_stock_receipts(supplier_id) WHERE deleted_at IS NULL;

-- Editable draft lines. Once the receipt is posted these are historical and
-- the movements become authoritative.
CREATE TABLE IF NOT EXISTS public.pos_stock_receipt_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID NOT NULL REFERENCES public.pos_stock_receipts(id),
  product_id UUID NOT NULL REFERENCES public.pos_products(id),
  variant_id UUID REFERENCES public.pos_product_variants(id),
  qty        NUMERIC(10,2) NOT NULL,
  unit_cost  NUMERIC(10,2),
  total_cost NUMERIC(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pos_receipt_items_receipt
  ON public.pos_stock_receipt_items(receipt_id) WHERE deleted_at IS NULL;

-- ── Stock counts ─────────────────────────────────────────────────────
--
-- A physical count never overwrites stock. Applying a count emits
-- 'count_correction' movements for each line whose counted quantity differs
-- from the system quantity, so the correction itself is auditable.
--
-- due_date exists because the approved POS Admin Overview shows a
-- "2 COUNTS DUE" tile — counts are scheduled work, not ad hoc.
CREATE TABLE IF NOT EXISTS public.pos_stock_counts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID REFERENCES public.pos_departments(id),
  name          TEXT,
  due_date      DATE,
  status        TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'submitted', 'applied', 'cancelled')),
  counted_by    UUID REFERENCES public.system_users(id),
  submitted_at  TIMESTAMPTZ,
  applied_by    UUID REFERENCES public.system_users(id),
  applied_at    TIMESTAMPTZ,
  note          TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pos_stock_counts_due
  ON public.pos_stock_counts(due_date)
  WHERE status IN ('draft', 'submitted') AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.pos_stock_count_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id    UUID NOT NULL REFERENCES public.pos_stock_counts(id),
  product_id  UUID NOT NULL REFERENCES public.pos_products(id),
  variant_id  UUID REFERENCES public.pos_product_variants(id),
  -- Captured when the count sheet is generated, so a sale during counting
  -- does not silently move the baseline under the counter's feet.
  system_qty  NUMERIC(10,2) NOT NULL DEFAULT 0,
  counted_qty NUMERIC(10,2),
  variance    NUMERIC(10,2),
  note        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pos_count_items_count
  ON public.pos_stock_count_items(count_id) WHERE deleted_at IS NULL;

-- ── Movement ledger ──────────────────────────────────────────────────
--
-- Immutable: no deleted_at. This is the source of truth for stock.
--
-- The eleven types are spec §15 verbatim. Six of them are user-selectable
-- on the Stock Adjustment screen (damage, expiry, wastage, loss_theft,
-- internal_use, count_correction via Physical Count); the rest originate
-- from other flows — 'opening' at product creation, 'purchase' from a
-- posted receipt, 'sale' from a completed order, 'customer_return' from a
-- refund.
CREATE TABLE IF NOT EXISTS public.pos_stock_movements (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.pos_products(id),
  variant_id UUID REFERENCES public.pos_product_variants(id),

  type TEXT NOT NULL CHECK (type IN (
    'opening', 'purchase', 'sale', 'customer_return',
    'damage', 'expiry', 'wastage', 'loss_theft',
    'internal_use', 'count_correction', 'manual_adjustment'
  )),

  -- Signed. Negative for a sale, damage, wastage; positive for a receipt or
  -- a customer return. Current stock is SUM(qty_delta) over all rows.
  qty_delta  NUMERIC(10,2) NOT NULL,
  -- Captured for the "Current stock: 4 -> New stock: 2" audit line on the
  -- adjustment screen, and so history reads without replaying the ledger.
  qty_before NUMERIC(10,2),
  qty_after  NUMERIC(10,2),

  -- Whichever flow produced this movement.
  order_id       UUID REFERENCES public.pos_orders(id),
  receipt_id     UUID REFERENCES public.pos_stock_receipts(id),
  stock_count_id UUID REFERENCES public.pos_stock_counts(id),

  -- Cost at the time of this movement, for margin and COGS reporting.
  unit_cost   NUMERIC(10,2),
  reason_note TEXT,
  created_by  UUID REFERENCES public.system_users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_movements_product
  ON public.pos_stock_movements(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pos_movements_type
  ON public.pos_stock_movements(type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pos_movements_order
  ON public.pos_stock_movements(order_id) WHERE order_id IS NOT NULL;
