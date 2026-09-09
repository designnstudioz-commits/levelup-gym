# Variant Inventory Rule (Locked)

**Status:** locked, implemented in `pos_complete_order()` as of the Phase B
closeout. This document exists so Phase D (catalogue admin) is designed
against a rule that's already live in the completion path, not invented
fresh when the admin UI gets built.

## The rule

> Inventory is tracked at the **lowest sellable SKU level**.
>
> - A product with no inventory-specific variants → stock is tracked on the
>   **product**.
> - A variant with its own SKU/barcode/price/stock → stock is tracked on
>   **that variant**.

Variants are never required. A plain product (no rows in
`pos_product_variants`) works exactly as it always has.

## Why this needed deciding now, not in Phase D

Sale completion (`pos_complete_order()`, migration `20260910100100`) is the
one place that actually decrements stock, and it had to pick a granularity
the moment it was made atomic. Building it against "always product-level"
and correcting it later would mean rewriting the one function everything
else depends on. So the rule was implemented in the RPC now, verified live,
and this document just records it for whoever builds the Phase D forms.

## How it's implemented

`pos_products.track_inventory` remains the **on/off switch** for the
product as a whole — it answers "does this product's stock get tracked at
all." When it's on, the RPC routes the actual quantity check and decrement
based on whether the order line specifies a variant:

```
line has variant_id  →  check & decrement pos_product_variants.stock_qty
line has no variant   →  check & decrement pos_products.stock_qty
```

Both tables already carry the necessary columns — `pos_product_variants`
has had its own `stock_qty` and `is_available` since the Phase A schema — so
**no migration was needed** to support this; only the completion logic
had to route to the right one. Availability is checked the same way: a
selected variant's own `is_available` gates the sale, in addition to the
parent product's.

Verified live against production: a product (`TEST — Gatorade`) with a
tracked variant (`TEST — Large`, stock 4) sold one unit — the **variant**
dropped to 3, the **parent product's own stock stayed at 48**, untouched.

## What this means for Phase D's catalogue forms

- **Add/Edit Product**: `track_inventory` stays a product-level toggle.
  When on, if the product has variants, the stock/low-stock fields should
  move to the **variant** rows, not the product row — the product-level
  `stock_qty` becomes meaningless for that product once variants take over
  quantity tracking (it's simply never touched by a sale that specifies a
  variant).
- **Add/Edit Variant**: needs its own stock quantity and low-stock
  threshold fields. `pos_product_variants` currently has `stock_qty` but
  **no `low_stock_threshold` column** — that's a small additive gap Phase D
  will need to close with its own migration when it gets there.
- **Receive Stock**: a receipt line needs to specify whether it's
  replenishing a product or a specific variant. `pos_stock_receipt_items`
  already has a nullable `variant_id` column from Phase A, so the schema is
  ready; the admin form just needs a variant picker when the chosen product
  has any.
- **Stock Adjustment / Counts**: same shape — `pos_stock_movements` and
  `pos_stock_count_items` already carry `variant_id`. Phase D's forms need
  to let a variant be picked, not just a product.
- **Low Stock Alerts**: the report needs to check `pos_products.stock_qty`
  for products with no variants, and each `pos_product_variants.stock_qty`
  for products that have them — not the product row for a variant-tracked
  product, which will be stale/unused.

None of this needs deciding today. It's flagged here precisely so Phase D
doesn't rebuild the same decision from scratch.
