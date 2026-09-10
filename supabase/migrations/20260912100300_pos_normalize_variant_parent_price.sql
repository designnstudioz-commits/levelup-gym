-- Phase D cleanup: normalize parent selling_price to 0 for every product
-- that has one or more active (non-deleted) variants.
--
-- LOCKED RULE: a product with variants is a catalogue container with no
-- customer-facing price of its own — the app already enforces this on every
-- new save (see src/app/api/pos/admin/products/route.ts and [id]/route.ts),
-- but this catches pre-existing rows saved before that rule existed.
--
-- Scope, exactly as specified:
--   - only products with >=1 active variant are touched
--   - only the parent's own selling_price column changes (to 0)
--   - variant prices are untouched
--   - products without variants are untouched
--   - pos_order_items is never touched — historical receipts already hold
--     their own price snapshot independent of the live catalogue, and nothing
--     here writes to that table.

UPDATE pos_products p
SET selling_price = 0
WHERE p.deleted_at IS NULL
  AND p.selling_price <> 0
  AND EXISTS (
    SELECT 1 FROM pos_product_variants v
    WHERE v.product_id = p.id AND v.deleted_at IS NULL
  );
