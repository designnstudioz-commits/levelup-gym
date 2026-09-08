-- Phase 3 / Stage A — configurable product modifier groups (spec §9).
--
-- NO RLS IN THIS FILE (see 20260909100000 header).
--
-- Shape follows the approved "01 HealthBox Product Modifiers" frame:
--   1. Sauce     — "Choose 1"                  -> single, required
--   2. Toppings  — "Optional • Select up to 4" -> multiple, max_select 4
--   3. Add-ons   — chips                       -> multiple, optional
--   4. Special note                            -> free text, stored on the
--                                                 order line (see
--                                                 pos_order_items.item_note)

-- Groups are reusable across products — one "Sauces" group serves every
-- wrap, bowl and sandwich. That is the reason for the join table below
-- rather than nesting modifiers directly under a product.
CREATE TABLE IF NOT EXISTS public.pos_modifier_groups (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = usable by any department. Set it to scope a group to one.
  department_id  UUID REFERENCES public.pos_departments(id),
  name           TEXT NOT NULL,
  selection_type TEXT NOT NULL DEFAULT 'single'
                   CHECK (selection_type IN ('single', 'multiple')),
  is_required    BOOLEAN DEFAULT FALSE,
  -- min_select is only meaningful for 'multiple'; a required 'single' group
  -- implies exactly one. max_select NULL = unlimited.
  min_select     INT DEFAULT 0,
  max_select     INT,
  sort_order     INT DEFAULT 0,
  status         TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.pos_modifiers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID NOT NULL REFERENCES public.pos_modifier_groups(id),
  name        TEXT NOT NULL,
  -- Most modifiers are free (a choice of sauce); add-ons carry a delta.
  price_delta NUMERIC(10,2) DEFAULT 0,
  is_default  BOOLEAN DEFAULT FALSE,
  is_available BOOLEAN DEFAULT TRUE,
  sort_order  INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pos_modifiers_group
  ON public.pos_modifiers(group_id) WHERE deleted_at IS NULL;

-- Which groups apply to which product, and in what order they are shown on
-- the Customize screen (the "1. Sauce / 2. Toppings / 3. Add-ons" numbering
-- comes from sort_order here, not from the group's own sort_order, because
-- the same group can sit at a different position on a different product).
CREATE TABLE IF NOT EXISTS public.pos_product_modifier_groups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.pos_products(id),
  group_id   UUID NOT NULL REFERENCES public.pos_modifier_groups(id),
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (product_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_pos_pmg_product
  ON public.pos_product_modifier_groups(product_id) WHERE deleted_at IS NULL;
