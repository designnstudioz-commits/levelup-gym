-- Phase 3 / Stage A — POS catalogue: departments, categories, suppliers,
-- products and variants.
--
-- NO RLS IN THIS FILE (see 20260909100000 header).
--
-- House rules applied throughout: soft delete via deleted_at, additive-only
-- columns, monetary values NUMERIC(10,2) in PKR, timestamps TIMESTAMPTZ UTC.

-- ── Departments ──────────────────────────────────────────────────────
--
-- Spec §4 is explicit: Supplements, Level Up Cafe and Accessories are
-- DEPARTMENTS of Level Up, not three separate financial vendors. Financial
-- ownership is therefore an attribute of the department, and there are
-- exactly two owners by business design — which is why financial_owner is
-- a two-value CHECK rather than a vendors FK.
--
-- HealthBox settlement (spec §18) is period-level: net sales minus approved
-- expenses, split 50/50, with losses staying wholly with HealthBox (§20).
-- There is deliberately NO per-line commission percentage anywhere in this
-- schema.
CREATE TABLE IF NOT EXISTS public.pos_departments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  slug            TEXT UNIQUE NOT NULL,
  financial_owner TEXT NOT NULL CHECK (financial_owner IN ('levelup', 'healthbox')),
  description     TEXT,
  sort_order      INT DEFAULT 0,
  status          TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

-- ── Categories ───────────────────────────────────────────────────────
-- Scoped to a department: "Protein" under Supplements and "Bowls" under
-- HealthBox are unrelated lists, and the terminal's category strip is
-- always rendered within one department.
CREATE TABLE IF NOT EXISTS public.pos_categories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL REFERENCES public.pos_departments(id),
  name          TEXT NOT NULL,
  sort_order    INT DEFAULT 0,
  status        TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pos_categories_department
  ON public.pos_categories(department_id) WHERE deleted_at IS NULL;

-- ── Suppliers ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pos_suppliers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  contact_person TEXT,
  phone          TEXT,
  email          TEXT,
  address        TEXT,
  notes          TEXT,
  status         TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);

-- ── Products ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pos_products (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL REFERENCES public.pos_departments(id),
  category_id   UUID REFERENCES public.pos_categories(id),
  supplier_id   UUID REFERENCES public.pos_suppliers(id),

  name          TEXT NOT NULL,
  description   TEXT,
  brand         TEXT,
  sku           TEXT,
  -- Barcode is stored and searchable from day one, but scanning hardware is
  -- NOT required for the POS to function (Phase 3 decision). A USB POS
  -- scanner behaves as a keyboard, so enabling it later needs no schema or
  -- protocol work — only flipping pos_settings.barcode_scanning_enabled.
  barcode       TEXT,
  image_url     TEXT,
  unit          TEXT,

  -- Cost is owner/manager-only. RLS cannot hide a single column (Postgres
  -- RLS is row-level, and Supabase gives every logged-in user the same
  -- `authenticated` DB role), so the terminal never reads this table
  -- directly — it goes through /api/pos/catalog, which strips cost and
  -- margin for non-owner/manager callers.
  cost_price    NUMERIC(10,2),
  selling_price NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Spec §11 requires BOTH pricing models, per product, not one global
  -- policy. 'fixed'   -> member_price is the member's price.
  --          'percent'-> member_discount_percent off selling_price.
  --          'none'   -> members pay list price.
  member_price_type       TEXT NOT NULL DEFAULT 'none'
                            CHECK (member_price_type IN ('none', 'fixed', 'percent')),
  member_price            NUMERIC(10,2),
  member_discount_percent NUMERIC(5,2),

  -- Normally NULL, meaning "inherit from the department". The approved
  -- Add Product screen exposes Financial Owner as its own field, so an
  -- override is possible, but it is owner-only in the UI: changing it moves
  -- money between Level Up and HealthBox at settlement time.
  financial_owner_override TEXT CHECK (financial_owner_override IN ('levelup', 'healthbox')),

  track_inventory     BOOLEAN DEFAULT FALSE,
  -- Derived cache of SUM(pos_stock_movements.qty_delta). The movement
  -- ledger is the source of truth; this column exists so the terminal grid
  -- does not aggregate on every render. Never write it directly — always
  -- post a movement.
  stock_qty           NUMERIC(10,2) DEFAULT 0,
  low_stock_threshold NUMERIC(10,2),

  -- Three independent states, per the approved Add Product screen:
  --   is_active    — the product exists and may be reported on
  --   show_on_pos  — it appears in the terminal grid at all
  --   is_available — it is in stock right now (one-tap "sold out")
  -- Collapsing these loses real operating cases: a discontinued line stays
  -- active for reporting but off the POS; a temporarily unavailable item
  -- stays on the POS greyed out so staff can see it exists.
  is_active     BOOLEAN DEFAULT TRUE,
  show_on_pos   BOOLEAN DEFAULT TRUE,
  is_available  BOOLEAN DEFAULT TRUE,

  sort_order    INT DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pos_products_department
  ON public.pos_products(department_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pos_products_category
  ON public.pos_products(category_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pos_products_barcode
  ON public.pos_products(barcode) WHERE barcode IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pos_products_low_stock
  ON public.pos_products(stock_qty)
  WHERE track_inventory = TRUE AND deleted_at IS NULL;

-- ── Variants ─────────────────────────────────────────────────────────
-- "Regular / Large", "1 scoop / 2 scoop". Priced as a delta against the
-- parent's selling_price so a base price change does not require editing
-- every variant.
CREATE TABLE IF NOT EXISTS public.pos_product_variants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID NOT NULL REFERENCES public.pos_products(id),
  name        TEXT NOT NULL,
  sku         TEXT,
  price_delta NUMERIC(10,2) DEFAULT 0,
  cost_delta  NUMERIC(10,2) DEFAULT 0,
  stock_qty   NUMERIC(10,2) DEFAULT 0,
  is_available BOOLEAN DEFAULT TRUE,
  sort_order  INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pos_variants_product
  ON public.pos_product_variants(product_id) WHERE deleted_at IS NULL;
