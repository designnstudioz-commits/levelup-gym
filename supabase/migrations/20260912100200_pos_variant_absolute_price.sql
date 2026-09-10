-- Phase D correction: variant pricing switches from a delta on top of the
-- product's selling_price to an absolute price per variant. A "large
-- bottle" variant is a distinct sellable item with its own price, not a
-- surcharge on the base product — the delta model was confusing to enter
-- correctly in the admin UI (staff would type the intended final price into
-- what was actually an add-on field).
--
-- Additive only: price_delta/cost_delta stay on the table (never dropped),
-- just unused by the app going forward. Existing rows are backfilled so
-- price/cost carry the same absolute figure the delta model already
-- resolved to, so no line item price silently changes.

ALTER TABLE pos_product_variants ADD COLUMN IF NOT EXISTS price NUMERIC(10,2);
ALTER TABLE pos_product_variants ADD COLUMN IF NOT EXISTS cost NUMERIC(10,2);

UPDATE pos_product_variants v
SET
  price = p.selling_price + v.price_delta,
  cost = CASE WHEN v.cost_delta IS NOT NULL THEN p.cost_price + v.cost_delta ELSE NULL END
FROM pos_products p
WHERE v.product_id = p.id AND v.price IS NULL;
