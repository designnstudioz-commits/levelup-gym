-- Phase 3D — variant-level tracking columns.
--
-- NO RLS IN THIS FILE (still its own reviewed change set).
--
-- The locked inventory rule: stock is tracked at the lowest sellable SKU.
-- A product with no inventory-specific variants tracks stock at the
-- product level (pos_products.stock_qty, already exists). A variant that
-- has its own SKU, barcode, price and stock tracks stock at the variant
-- level instead — the atomic completion function (pos_complete_order,
-- migration 20260910100200) already branches on variant_id to do exactly
-- this, but two columns it needs on the variant side were never added in
-- Phase A: a low-stock threshold, and a barcode of its own (pos_products
-- has always had `barcode`; pos_product_variants never did).
--
-- Both additive and nullable — no existing row or query is affected.
ALTER TABLE public.pos_product_variants
  ADD COLUMN IF NOT EXISTS low_stock_threshold NUMERIC(10,2);

ALTER TABLE public.pos_product_variants
  ADD COLUMN IF NOT EXISTS barcode TEXT;

CREATE INDEX IF NOT EXISTS idx_pos_variants_barcode
  ON public.pos_product_variants(barcode) WHERE barcode IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN public.pos_product_variants.low_stock_threshold IS
  'Variant-level low-stock alert threshold. Only meaningful when this variant is the sellable SKU being stock-tracked (see the locked inventory rule).';
COMMENT ON COLUMN public.pos_product_variants.barcode IS
  'Variant-specific barcode, distinct from the parent product''s. Optional — most variants share the parent''s barcode or have none.';
