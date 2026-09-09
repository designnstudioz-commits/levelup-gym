# Phase 3B — Temporary Test Catalogue

**STATUS: REMOVED.** The manual smoke test passed and cleanup ran on
2026-09-11. All TEST- products, their modifier groups/options, the test
variant, and orders LU-1001 through **LU-1006** (LU-1006 was created during
the human smoke test itself, found and included) are gone from production.
Verified via direct query: zero `TEST-%` products, zero `TEST — %`
modifier groups, zero of those six order numbers remain. This file is now
a historical record, kept for the record of what was seeded and how it was
removed — not an active to-do.

**Not a migration.** This SQL was run once, directly against production, via
the Supabase Management API — deliberately kept out of `supabase/migrations/`
per the instruction not to make temporary test data a permanent schema
change. This file is the record of what was inserted and, at the bottom,
exactly how to remove it before launch.

Every row is identifiable by a `TEST-` SKU prefix (products) or a
`TEST — ` name prefix (products and modifier groups).

## Update — Phase B closeout

One test variant was added while verifying the atomic completion function
and the variant-inventory rule: **TEST — Large** (`TEST-GATO-LG`), a
variant of TEST — Gatorade, +Rs 50, seeded with stock 4. It is cleaned up
in the same pass as the parent product (variants cascade via
`product_id`, no separate delete needed once the product row goes).

Two more test sales were created: **LU-1004** (the variant, with a 10%
order discount) and **LU-1005** (resumed from held order **H-002**). Both
added to the cleanup list below.

## What was seeded

| Product | SKU | Department | Tests |
|---|---|---|---|
| TEST — Creatine | `TEST-CREA` | Supplements | Percentage member discount (10%), low stock (3 left, threshold 5) |
| TEST — Gatorade | `TEST-GATO` | Level Up Cafe | Fixed member price (Rs 300 vs Rs 350 list) |
| TEST — Gym Shaker | `TEST-SHAK` | Accessories | Sold out / unavailable |
| TEST — HealthBox Special Bowl | `TEST-BOWL` | HealthBox | Modifier groups (below) |

**TEST — HealthBox Special Bowl** modifier groups:

| Group | Type | Rule | Options |
|---|---|---|---|
| TEST — Sauce | single | required, exactly 1 | Dynamic (default), Chipotle, Honey Mustard, BBQ |
| TEST — Toppings | multiple | optional, up to 4 | Cheese, Jalapeño, Olives, Salsa, Sweet Corn, Red Beans |
| TEST — Add-ons | multiple | optional, unlimited | Extra Chicken +Rs 150, Extra Cheese +Rs 100, Extra Sauce +Rs 50 |

## Insert script (as run)

```sql
WITH new_products AS (
  INSERT INTO public.pos_products
    (department_id, name, sku, description, selling_price,
     member_price_type, member_price, member_discount_percent,
     track_inventory, stock_qty, low_stock_threshold,
     is_active, show_on_pos, is_available)
  VALUES
    ('d02ab235-babf-4ca2-b57f-9e61ef4fd10e', 'TEST — Creatine', 'TEST-CREA',
     'Temporary test product — Phase 3B', 6500, 'percent', NULL, 10,
     true, 3, 5, true, true, true),
    ('6fe1b129-78ff-4432-8440-f390932f3187', 'TEST — Gatorade', 'TEST-GATO',
     'Temporary test product — Phase 3B', 350, 'fixed', 300, NULL,
     true, 50, 10, true, true, true),
    ('cdb8cdc2-4c70-4d8b-8acf-3ccfc69508e6', 'TEST — Gym Shaker', 'TEST-SHAK',
     'Temporary test product — Phase 3B', 850, 'none', NULL, NULL,
     false, 0, NULL, true, true, false),
    ('b27c15e7-9e3d-4773-8870-ac93a04edad3', 'TEST — HealthBox Special Bowl', 'TEST-BOWL',
     'Temporary test product — Phase 3B', 1200, 'none', NULL, NULL,
     false, 0, NULL, true, true, true)
  RETURNING id, sku
),
bowl AS (SELECT id FROM new_products WHERE sku = 'TEST-BOWL'),
sauce_group AS (
  INSERT INTO public.pos_modifier_groups (department_id, name, selection_type, is_required, min_select, max_select, sort_order)
  SELECT 'b27c15e7-9e3d-4773-8870-ac93a04edad3', 'TEST — Sauce', 'single', true, 1, 1, 1
  RETURNING id
),
toppings_group AS (
  INSERT INTO public.pos_modifier_groups (department_id, name, selection_type, is_required, min_select, max_select, sort_order)
  SELECT 'b27c15e7-9e3d-4773-8870-ac93a04edad3', 'TEST — Toppings', 'multiple', false, 0, 4, 2
  RETURNING id
),
addons_group AS (
  INSERT INTO public.pos_modifier_groups (department_id, name, selection_type, is_required, min_select, max_select, sort_order)
  SELECT 'b27c15e7-9e3d-4773-8870-ac93a04edad3', 'TEST — Add-ons', 'multiple', false, 0, NULL, 3
  RETURNING id
),
sauce_mods AS (
  INSERT INTO public.pos_modifiers (group_id, name, price_delta, is_default, sort_order)
  SELECT sauce_group.id, m.name, 0, m.is_default, m.sort_order
  FROM sauce_group, (VALUES ('Dynamic', true, 1), ('Chipotle', false, 2), ('Honey Mustard', false, 3), ('BBQ', false, 4))
    AS m(name, is_default, sort_order)
  RETURNING id
),
topping_mods AS (
  INSERT INTO public.pos_modifiers (group_id, name, price_delta, is_default, sort_order)
  SELECT toppings_group.id, m.name, 0, false, m.sort_order
  FROM toppings_group, (VALUES ('Cheese',1),('Jalapeño',2),('Olives',3),('Salsa',4),('Sweet Corn',5),('Red Beans',6))
    AS m(name, sort_order)
  RETURNING id
),
addon_mods AS (
  INSERT INTO public.pos_modifiers (group_id, name, price_delta, is_default, sort_order)
  SELECT addons_group.id, m.name, m.price_delta, false, m.sort_order
  FROM addons_group, (VALUES ('Extra Chicken',150,1),('Extra Cheese',100,2),('Extra Sauce',50,3))
    AS m(name, price_delta, sort_order)
  RETURNING id
),
links AS (
  INSERT INTO public.pos_product_modifier_groups (product_id, group_id, sort_order)
  SELECT bowl.id, g.id, g.sort_order
  FROM bowl, (
    SELECT id, 1 AS sort_order FROM sauce_group
    UNION ALL SELECT id, 2 FROM toppings_group
    UNION ALL SELECT id, 3 FROM addons_group
  ) AS g
  RETURNING id
)
SELECT
  (SELECT COUNT(*) FROM new_products)  AS products,
  (SELECT COUNT(*) FROM sauce_mods)    AS sauce_options,
  (SELECT COUNT(*) FROM topping_mods)  AS topping_options,
  (SELECT COUNT(*) FROM addon_mods)    AS addon_options,
  (SELECT COUNT(*) FROM links)         AS links;
```

## Cleanup — run before production launch

Test **sales** created while verifying Phase B are removed first (their
`order_items`/`stock_movements` reference the test products by foreign key,
so the products can't be deleted while those rows exist), then the
**catalogue** rows.

**Five** test sales exist as of the Phase B closeout — all listed below.
**Keep all of it in place for now, per your instruction, until the manual
smoke test is done.**

```
543023e4-1210-4c21-9f42-89c3da50fc2b   -- LU-1001
b15ed278-56ec-4e37-842a-79c09804a8f7   -- LU-1002 (split payment)
8728d54b-8084-4e7f-8fd1-d533e25dac2f   -- LU-1003 (was H-001)
342d13b6-aca4-43d2-9a3d-5f89e081e17f   -- LU-1004 (variant + 10% discount)
478708b3-60a1-4d9e-bfc2-4cbe27cfebc2   -- LU-1005 (was H-002)
```

```sql
-- 1. Test sales
DELETE FROM public.pos_stock_movements WHERE order_id IN (
  '543023e4-1210-4c21-9f42-89c3da50fc2b', 'b15ed278-56ec-4e37-842a-79c09804a8f7',
  '8728d54b-8084-4e7f-8fd1-d533e25dac2f', '342d13b6-aca4-43d2-9a3d-5f89e081e17f',
  '478708b3-60a1-4d9e-bfc2-4cbe27cfebc2'
);
DELETE FROM public.pos_payments WHERE order_id IN (
  '543023e4-1210-4c21-9f42-89c3da50fc2b', 'b15ed278-56ec-4e37-842a-79c09804a8f7',
  '8728d54b-8084-4e7f-8fd1-d533e25dac2f', '342d13b6-aca4-43d2-9a3d-5f89e081e17f',
  '478708b3-60a1-4d9e-bfc2-4cbe27cfebc2'
);
DELETE FROM public.pos_order_items WHERE order_id IN (
  '543023e4-1210-4c21-9f42-89c3da50fc2b', 'b15ed278-56ec-4e37-842a-79c09804a8f7',
  '8728d54b-8084-4e7f-8fd1-d533e25dac2f', '342d13b6-aca4-43d2-9a3d-5f89e081e17f',
  '478708b3-60a1-4d9e-bfc2-4cbe27cfebc2'
);
DELETE FROM public.pos_orders WHERE id IN (
  '543023e4-1210-4c21-9f42-89c3da50fc2b', 'b15ed278-56ec-4e37-842a-79c09804a8f7',
  '8728d54b-8084-4e7f-8fd1-d533e25dac2f', '342d13b6-aca4-43d2-9a3d-5f89e081e17f',
  '478708b3-60a1-4d9e-bfc2-4cbe27cfebc2'
);
DELETE FROM public.activity_logs WHERE entity_id IN (
  '543023e4-1210-4c21-9f42-89c3da50fc2b', 'b15ed278-56ec-4e37-842a-79c09804a8f7',
  '8728d54b-8084-4e7f-8fd1-d533e25dac2f', '342d13b6-aca4-43d2-9a3d-5f89e081e17f',
  '478708b3-60a1-4d9e-bfc2-4cbe27cfebc2'
);
-- Also remove any real sales made during YOUR manual smoke test before
-- launch — check activity_logs / pos_orders for order_no > LU-1005 with
-- a TEST- sku on their items.

-- 2. Catalogue
DELETE FROM public.pos_product_variants
  WHERE sku = 'TEST-GATO-LG'
     OR product_id IN (SELECT id FROM public.pos_products WHERE sku LIKE 'TEST-%');
DELETE FROM public.pos_product_modifier_groups
  WHERE product_id IN (SELECT id FROM public.pos_products WHERE sku LIKE 'TEST-%');
DELETE FROM public.pos_modifiers
  WHERE group_id IN (SELECT id FROM public.pos_modifier_groups WHERE name LIKE 'TEST — %');
DELETE FROM public.pos_modifier_groups
  WHERE name LIKE 'TEST — %';
DELETE FROM public.pos_products
  WHERE sku LIKE 'TEST-%';
```

**Verify clean** after running both blocks:

```sql
SELECT
  (SELECT COUNT(*) FROM pos_products WHERE sku LIKE 'TEST-%')          AS test_products,
  (SELECT COUNT(*) FROM pos_modifier_groups WHERE name LIKE 'TEST — %') AS test_groups;
-- expect 0, 0
```
