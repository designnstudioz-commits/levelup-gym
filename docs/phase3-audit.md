# Phase 3 Audit — POS, Inventory & HealthBox

**Status:** Audit only. No files, schema, routes or behaviour have been modified.
**Date:** 8 September 2026
**Awaiting:** approval before implementation.

---

## 0. Figma status — RESOLVED (8 Sep 2026)

Originally this section recorded that the Figma returned HTTP 403 and that I had not seen
the approved screens. **That is no longer true.** A read-only personal access token was
added to `.env.local`, and all **22 frames across 5 pages** have been rendered and reviewed.

**The findings are in a companion document: [`phase3-figma-reconciliation.md`](./phase3-figma-reconciliation.md).**

It supersedes this audit wherever the two differ. In summary it produced:
- **15 schema deltas** (§4 of that document), taking the table count from 15 to **17** —
  `pos_stock_receipts` and `pos_approvals` are both required and were missing here
- **12 new conflicts** (C4–C15), several of which need your decision
- Confirmation that every core architecture call in this audit survives contact with the
  approved UX

Read that document alongside this one. The sections below stand except where it corrects
them.

---

## 1. Current architecture

### 1.1 Two runtimes, one database

| # | Component | Hosting | Role |
|---|-----------|---------|------|
| 1 | Next.js 16 app (App Router, TypeScript, Turbopack) | Vercel | Everything staff/members touch, plus device-facing API routes |
| 2 | `relay-service/` — standalone Express | Linux VM (GCP), nginx + systemd | Parallel implementation of four ZKTeco endpoints |

The relay exists because Vercel's bot protection serves a JS challenge to datacentre IPs,
which ZKTeco terminals cannot solve. **Phase 3 does not touch the relay** and must not.

### 1.2 Stack

Next.js 16 · Supabase (PostgreSQL) · Supabase Auth (email/password) · Tailwind CSS v4 ·
React Hook Form + Zod (registration only; everything else is plain `useState`) · Recharts ·
Lucide icons · Sonner toasts · date-fns.

Deployment: GitHub → Vercel on push to `main`. **Migrations are applied manually** in the
Supabase SQL editor — there is no migration runner in the pipeline. A deploy that depends
on an unapplied migration fails in production.

### 1.3 Request path and auth

```
Browser
  → middleware.ts            (Supabase SSR session; guards /dashboard/* only)
  → dashboard/layout.tsx     (server component: looks up system_users by EMAIL)
  → CurrentUserProvider      (id, full_name, role, staff_id → client tree)
  → page.tsx                 (client component; useRoleGuard on 6 pages only)
  → supabase/client.ts       (browser client, ANON KEY, direct table access)
```

**The last line is the important one.** Client pages query Supabase tables directly with
the anon key. With RLS disabled (§4.4), the browser can read and write every table
regardless of what the UI shows.

### 1.4 Existing financial logic that Phase 3 must not disturb

| Module | Location | Why it is fragile |
|--------|----------|-------------------|
| Split payment convention | `fee_payments`, `groupPaymentsByReceipt()` | Multiple rows share one `receipt_no`; only the **first** row carries `balance_due`, `commission_*`, `months_covered`, `package_breakdown`. Every report depends on this. |
| Expiry maths | `extendExpiryDate()` in `src/lib/utils.ts` | Single source of truth. Special-cases a member's first payment, and first-payment-that-is-a-multi-month-advance. |
| Trainer commission | `src/lib/commission.ts` | Hard cap of **one qualifying payment per period per member** — guards against split payments double-paying a trainer. |
| Cash-basis revenue | reports | Grouped by `payment_date`. Deliberate. |

---

## 2. Existing design system — exact tokens and components to reuse

### 2.1 Tokens (`src/app/globals.css`, Tailwind v4 `@theme`)

```
--color-brand-orange:        #F06418     --color-brand-orange-dark:  #C04E10
--color-brand-orange-light:  #FEF0E8     --color-brand-orange-mid:   #FDDCC8
--color-brand-dark:          #111111     --color-brand-sidebar:      #1A1A1A
--color-brand-border:        #E4E4DE
--color-brand-text:          #1A1A16     --color-brand-text-secondary: #4A4A44
--color-brand-text-muted:    #7A7A72
--font-sans:      var(--font-barlow)
--font-condensed: var(--font-barlow-condensed)
```

Dashboard page ground is `#F8F8F6`; card ground is white.

**Observed conventions.** Colours are written as literal hex in `className` throughout
(`bg-[#F06418]`), not via the theme variables. Follow the existing literal-hex style in POS
code for consistency rather than introducing a second convention.

| Property | Established value |
|----------|-------------------|
| Card | `bg-white border border-[#E4E4DE] rounded-xl p-5` |
| Button radius | `rounded-lg` |
| Input / Select | `rounded-lg`, `px-3 py-2 text-sm`, focus ring `ring-2 ring-[#F06418]` |
| Badge | `rounded-full px-2 py-0.5 text-xs font-medium border` |
| Modal | `rounded-xl`, backdrop `bg-black/40 backdrop-blur-sm`, `z-50` |
| Transition | `transition-colors duration-150` |
| Shadows | None, except `shadow-xl` on Modal |
| Page heading | Barlow Condensed, `uppercase tracking-wide` |
| Stat figure | `text-2xl font-bold` Barlow Condensed |

### 2.2 Components to reuse verbatim

| Component | Path | POS use |
|-----------|------|---------|
| `Button` | `ui/Button.tsx` | Admin screens. **Terminal needs a new size** — see §7.1 |
| `Card`, `CardHeader` | `ui/Card.tsx` | Every admin panel |
| `Input` | `ui/Input.tsx` | Catalogue forms (has a date-year guard built in) |
| `Select` | `ui/Select.tsx` | Department/category/supplier pickers |
| `Badge` | `ui/Badge.tsx` | Order status, stock status. **Needs new variants** — §7.1 |
| `Modal` | `ui/Modal.tsx` | Admin dialogs. **Not** the POS payment sheet (must be full-screen) |
| `StatsCard` | `ui/StatsCard.tsx` | POS overview and owner dashboard tiles |
| `SortableTh`, `useSortToggle`, `compareValues` | `ui/SortableTh.tsx` | Every admin table |
| `ViewToggle` | `ui/ViewToggle.tsx` | Product catalogue grid/list |
| `DashboardHeader` | `layout/DashboardHeader.tsx` | All `/dashboard/pos/*` pages |
| `NumberInputWheelGuard` | `components/` | Price fields — stops scroll silently changing a price |
| `PaymentSplitRows` | `forms/PaymentSplitRows.tsx` | **Logic reusable, UI is not** — §7.2 |
| `formatPKR`, `formatDate`, `formatDateTime`, `cn`, `calculateDiscount`, `fetchAllRows` | `lib/utils.ts` | Directly |
| `toast` (Sonner) | — | All notifications |
| Lucide icons | — | All icons. No emoji. |

### 2.3 The visual rule, applied

The Figma's black/green is reference for **structure only**. The terminal will use the
Level Up palette: `#F06418` for the primary action and active states, `#1A1A1A` for the
terminal's top bar and department rail (matching the existing sidebar), white product
tiles with `#E4E4DE` borders and `rounded-xl` — the same `Card` treatment, scaled up. The
terminal will read as the same product, just touch-sized.

---

## 3. Current auth and roles, and how to add the two new roles safely

### 3.1 How it works today

`system_users` (login account) is separate from `staff_members` (employment record).
Roles: `owner | manager | receptionist | trainer | viewer`.

**Identity keys on email, not `auth.uid()`.** One live account has a mismatched
`system_users.id` vs `auth.users.id`; correcting it would cascade FK updates across ~10
tables. Every lookup — `dashboard/layout.tsx`, `useRoleGuard`, the API routes, and the RLS
helper functions — matches on `lower(email)`. **New roles must follow this.**

### 3.2 Four tiers of enforcement, only one of them real

| Tier | Mechanism | Coverage |
|------|-----------|----------|
| 1 — Real | Server-side role check | `api/admin/create-user`, `api/admin/delete-user`, `/dashboard/settings` |
| 2 — Client guard | `useRoleGuard()` redirects after mount | `packages`, `family-approvals`, `staff`, `salary-slip`, `reports`, `commissions` |
| 3 — Nav visibility only | Sidebar hides the link; **direct URL works** | `submissions`, `fees`, `members`, `members/[id]`, `attendance`, `daily-members`, `register` |
| 4 — Cosmetic | Figures hidden inline | Revenue on `fees`, `daily-members`, dashboard home for receptionist |

### 3.3 Four blockers to adding roles safely

**B1 — `dashboard/page.tsx` falls through to the owner dashboard.**

```ts
const role = currentUser?.role ?? "viewer";
if (role === "trainer")      return <TrainerDashboard />;
if (role === "viewer")       return <ViewerDashboard />;
if (role === "receptionist") return <ReceptionistDashboard />;
// ...falls through to the full owner/manager dashboard
```

Adding `cashier` without touching this file shows a cashier **the full owner dashboard,
including revenue**. Same for `healthbox_staff`. This is the single highest-risk line in
the whole phase.

**B2 — `canAccess()` fails open.** In `Sidebar.tsx`:

```ts
const allowed = NAV_ROLES[href];
if (!allowed) return true;      // route not listed → visible to EVERY role
```

Every new POS route must be listed explicitly, or omission grants access.

**B3 — `middleware.ts` guards `/dashboard` only.** Its matcher excludes `iclock` and
`api/attendance`, and the guard is `pathname.startsWith("/dashboard")`. **`/pos` and
`/api/pos/*` would be entirely unauthenticated.** The post-login redirect also hardcodes
`/dashboard`.

**B4 — RLS is off everywhere.** See §4.4. Until it is on, a HealthBox staff login can read
the whole database with the anon key from the browser console, whatever the UI shows.

### 3.4 Recommended approach

| ID | Step |
|----|------|
| A1 | **Apply the staged RLS baseline first.** 20 migrations already written (`20260825*`). This is a hard prerequisite for HealthBox staff accounts, not a nice-to-have. |
| A2 | Migration: extend the `system_users.role` CHECK to add `'cashier'` and `'healthbox_staff'` — recreate the constraint with the full old list plus the two new values (never remove). |
| A3 | Add both to `SystemRole` in `src/types/database.ts`. |
| A4 | **Add explicit branches in `dashboard/page.tsx`** before any other work touching roles. |
| A5 | `dashboard/layout.tsx`: redirect `cashier` → `/pos`; `healthbox_staff` → `/dashboard/pos/healthbox`. |
| A6 | `middleware.ts`: extend the guard to `/pos` and `/api/pos`; make the post-login redirect role-aware. |
| A7 | Add every POS route to `NAV_ROLES` explicitly. |
| A8 | Add `system_users.pos_department_scope UUID[]` (nullable; `NULL` = unrestricted) so HealthBox scoping is data-driven rather than hardcoded to one role. RLS policies read this column. |
| A9 | Add `system_users.manager_pin_hash TEXT` (nullable) for void/discount override, verified **server-side only**. |
| A10 | Serve the POS catalogue through `/api/pos/catalog`, which strips `cost_price` and margin for non-owner/manager callers. Postgres RLS is row-level, not column-level, and Supabase gives every logged-in user the same `authenticated` DB role — so column hiding **cannot** be done with RLS alone. |

---

## 4. Current database — what Phase 3 integrates with, and what must not move

### 4.1 Integrate with (read, extend additively)

| Table | Phase 3 relationship |
|-------|---------------------|
| `system_users` | Two new roles; two new nullable columns (A8, A9). No existing column changes. |
| `members` | **Read-only** for POS. Member lookup, tagging, member pricing. |
| `staff_members` | Optional link for cashier/HealthBox staff records. |
| `activity_logs` | **Insert only.** Every POS event logs here (spec §29). |
| `expenses` | Existing gym expenses. HealthBox expenses need approval + attachments + scope — see §5.5. |

### 4.2 Must remain untouched

`fee_payments` · `submissions` · `packages` · `attendances` · `unverified_attendances` ·
`devices` · `device_commands` · `device_enrollments` · `trainer_member_commissions` ·
`trainer_commission_ledger` · `daily_members` · `sms_log` · `staff_tasks`.

And in code: `extendExpiryDate()`, `groupPaymentsByReceipt()`, `src/lib/commission.ts`, the
registration wizard, everything under `src/app/api/attendance/*` and `src/app/iclock/*`,
and all of `relay-service/`.

**Spec §23 is already the architecture.** POS sales get dedicated tables; membership and
POS finance combine only at the reporting layer. No change of direction needed.

### 4.3 Existing gaps Phase 3 inherits

| ID | Gap | Impact on Phase 3 |
|----|-----|-------------------|
| G-01 | RLS disabled on all 19 tables | **Blocks HealthBox staff accounts** |
| G-02 | Submission approval has no role check | Unrelated, but same class of bug |
| G-03 | Most pages nav-visibility-only | POS must not repeat it |
| G-06 | `canAccess()` fails open | Directly affects new roles |
| G-09 | `database.ts` types cover 11 of 19 tables | POS must not extend the gap |
| G-11 | Migrations applied by hand | Deployment sequencing risk — §10 |
| **NEW** | **`/api/upload/photo` and `/api/upload/document` have no auth check at all** | They use the **service-role key** and accept any POST from anyone on the internet. Product-image upload would inherit this. **Fix before Phase D.** |

### 4.4 RLS status in detail

RLS is **disabled on every table**. Twenty migrations implementing it in full were authored
25 August 2026 and sit **untracked in the working directory** — written, reviewed, never
applied. They build on four `SECURITY DEFINER` helpers: `current_system_user_id()`,
`current_role()`, `current_staff_id()`, `current_role_in(text[])`, all keyed on
`lower(auth.jwt() ->> 'email')`.

The POS policies I propose reuse those helpers directly, so applying the baseline first is
also the cheapest path.

---

## 5. Proposed POS database changes

No migrations written. Fifteen new tables.

### 5.1 Departments — not vendors

Per spec §4, Supplements / Level Up Cafe / Accessories are **departments of Level Up**, not
separate financial vendors. Financial ownership lives on the department.

```
pos_departments
  id, name, slug, financial_owner ('levelup' | 'healthbox'),
  sort_order, color, icon, status, created_at, updated_at, deleted_at
```

Seeded with exactly four rows: Supplements, Level Up Cafe, Accessories (all
`financial_owner='levelup'`), HealthBox (`financial_owner='healthbox'`).

`financial_owner` is deliberately a small enum rather than a vendor FK — it is the axis
every settlement and report splits on, and there are two values by business design.

### 5.2 Catalogue

```
pos_categories          id, department_id, name, sort_order, color, status, …, deleted_at
pos_suppliers           id, name, contact_person, phone, email, notes, status, …, deleted_at
pos_products            id, department_id, category_id, name, description, brand,
                        sku, barcode, image_url, unit, supplier_id,
                        cost_price, selling_price,
                        member_price_type ('none'|'fixed'|'percent'),
                        member_price, member_discount_percent,
                        track_inventory, stock_qty, low_stock_threshold,
                        is_active, is_available, sort_order, …, deleted_at
pos_product_variants    id, product_id, name, sku, price_delta, cost_delta,
                        stock_qty, sort_order, …, deleted_at
```

`member_price_type` satisfies spec §11's requirement to support **both** a fixed member
price and a percentage discount, per product, without forcing one model globally.

### 5.3 Modifiers (spec §9)

```
pos_modifier_groups        id, name, department_id,
                           selection_type ('single'|'multiple'),
                           is_required, min_select, max_select, sort_order, …, deleted_at
pos_modifiers              id, group_id, name, price_delta, is_default, sort_order, …, deleted_at
pos_product_modifier_groups  product_id, group_id, sort_order        (join)
```

Groups are reusable across products (one "Sauces" group serves every wrap), which is why
the join table exists rather than nesting modifiers under products.

### 5.4 Orders

```
pos_register_sessions   id, terminal_name, cashier_id, opened_at, opening_cash,
                        closed_at, counted_cash, expected_cash, variance,
                        order_count, payment_method_totals JSONB, note, …, deleted_at

pos_orders              id, order_no, session_id, status
                          ('open'|'held'|'completed'|'voided'|'refunded'|'partially_refunded'),
                        customer_type ('walk_in'|'member'|'daily_member'|'staff'),
                        member_id, daily_member_id, staff_id, customer_label,
                        gross_amount, discount_type, discount_value, discount_amount,
                        net_amount, item_count,
                        levelup_net_amount, healthbox_net_amount,     ← denormalised, see below
                        served_by, completed_at,
                        voided_by, voided_at, void_reason,
                        refund_of_order_id, discount_authorised_by,
                        held_at, held_label, note, …, deleted_at

pos_order_items         id, order_id, product_id, variant_id,
                        -- snapshots (spec §24)
                        department_id, department_name, financial_owner,
                        product_name, variant_name, brand, sku,
                        unit_price, cost_price, qty,
                        modifiers JSONB,          -- [{group, name, price_delta}]
                        modifiers_total,
                        line_gross, line_discount, line_net,
                        member_price_applied BOOLEAN, member_price_type, member_price_value,
                        created_at                 -- NO deleted_at: immutable

pos_payments            id, order_id,
                        method ('Cash'|'Card'|'Bank Transfer'|'EasyPaisa'|'JazzCash'),
                        amount, tendered, change_given, reference,
                        created_at                 -- NO deleted_at: immutable
```

**Why `financial_owner` is on the line item.** Spec §21 requires ownership identifiable at
line level in a mixed basket. Storing it as a snapshot (not a join through
`product → department`) means a product later moving department cannot rewrite history.

**Why `levelup_net_amount` / `healthbox_net_amount` are on the order.** Settlement and the
owner dashboard both aggregate by owner across large date ranges. Denormalising the
per-order split avoids a join-and-group over every line for every report. They are derived
at completion and never recomputed.

### 5.5 Inventory (spec §15)

```
pos_stock_movements     id, product_id, variant_id, type, qty_delta,
                        reason_note, order_id, stock_count_id,
                        unit_cost, supplier_id, reference,
                        created_by, created_at    -- immutable ledger

pos_stock_counts        id, department_id, status ('draft'|'submitted'|'applied'),
                        counted_by, applied_by, applied_at, note, …, deleted_at
pos_stock_count_items   id, count_id, product_id, system_qty, counted_qty, variance
```

`type` enum, all values from spec §15: `opening`, `purchase`, `sale`, `customer_return`,
`damage`, `expiry`, `wastage`, `loss_theft`, `internal_use`, `count_correction`,
`manual_adjustment`.

`pos_products.stock_qty` is a **derived cache** of `SUM(qty_delta)`, never the source of
truth. Applying a stock count generates `count_correction` movements — it never overwrites
a quantity, per spec §15.

HealthBox uses the same tables but only the `available` / `sold_out` flag, receiving,
wastage and expiry — no recipe or BOM depletion, per spec §16.

### 5.6 HealthBox expenses and settlement (spec §18, §20, §22)

**This is where I most need to correct my earlier plan.** The HealthBox model is **not** a
per-line commission split. It is period-level:

```
Net Sales (after discounts)  −  Approved Expenses  =  Net Profit
Net Profit > 0  →  50% HealthBox, 50% Level Up
Net Profit < 0  →  100% HealthBox        (spec §20 — loss is NOT shared)
```

So there are **no per-line share columns**. The line carries `financial_owner` and
`line_net`; the split is computed once per period.

```
pos_healthbox_expenses      id, expense_date, category, title, amount,
                            description, attachment_urls TEXT[],
                            status ('pending'|'approved'|'rejected'),
                            submitted_by, approved_by, approved_at,
                            rejection_reason, settlement_id, …, deleted_at

pos_settlements             id, financial_owner ('healthbox'),
                            period_type ('weekly'|'monthly'), period_start, period_end,
                            gross_sales, total_discounts, net_sales,
                            approved_expenses, net_profit,
                            levelup_share, healthbox_share,      -- both 0 when net_profit < 0
                            is_loss BOOLEAN, loss_amount,
                            status ('draft'|'finalised'|'paid'),
                            finalised_by, finalised_at, paid_at, payment_method, note,
                            …, deleted_at

pos_settings                key, value JSONB      -- settlement period, tab limit,
                                                  -- cashier discount ceiling, void window
```

`pos_settings` exists so settlement frequency changes without a code change (spec §22).

A separate expenses table rather than reusing `expenses` because: it needs an approval
workflow, attachments, a submitter and a settlement link, and it must be scoped so
HealthBox staff see only their own — none of which `expenses` supports, and adding them
would put third-party financial data in the gym's expense ledger, contrary to spec §23.

### 5.7 Table count

15 new tables. All follow house rules: `deleted_at` soft delete except the three deliberate
immutable ledgers (`pos_order_items`, `pos_payments`, `pos_stock_movements`), additive-only
columns, one timestamped migration file each, RLS policies shipped **with** each table.

---

## 6. Routes and navigation

### 6.1 Terminal

| Route | Access | Notes |
|-------|--------|-------|
| `/pos` | owner, manager, cashier, receptionist | **Own full-screen layout**, no dashboard sidebar |
| `/r/[order_no]` | **Public, unauthenticated** | Digital receipt, QR target. One order only. |

### 6.2 Admin — "POS & Inventory" nav group

| Route | Access |
|-------|--------|
| `/dashboard/pos` (Overview) | owner, manager |
| `/dashboard/pos/orders` | owner, manager |
| `/dashboard/pos/catalog/departments` | owner, manager |
| `/dashboard/pos/catalog/categories` | owner, manager |
| `/dashboard/pos/catalog/products` | owner, manager, **healthbox_staff** (scoped) |
| `/dashboard/pos/catalog/modifiers` | owner, manager, **healthbox_staff** (scoped) |
| `/dashboard/pos/inventory` | owner, manager |
| `/dashboard/pos/inventory/receive` | owner, manager, **healthbox_staff** (scoped) |
| `/dashboard/pos/inventory/adjustments` | owner, manager |
| `/dashboard/pos/inventory/counts` | owner, manager |
| `/dashboard/pos/inventory/movements` | owner, manager |
| `/dashboard/pos/inventory/alerts` | owner, manager |
| `/dashboard/pos/suppliers` | owner, manager |
| `/dashboard/pos/sessions` | owner, manager |
| `/dashboard/pos/reports` | owner, manager |
| `/dashboard/pos/healthbox` | owner, manager, **healthbox_staff** |
| `/dashboard/pos/healthbox/expenses` | owner, manager, **healthbox_staff** |
| `/dashboard/pos/healthbox/settlement` | **owner, manager only** |

Note `/dashboard/pos/inventory/adjustments` excludes `healthbox_staff` — spec §17 forbids
them unrestricted manual quantity adjustments, while §17 permits receiving and wastage.
Wastage and expiry are recorded through the receive/wastage screen, not the adjustments
screen.

### 6.3 API

`/api/pos/catalog` (GET, cost-stripped) · `/api/pos/orders` · `/api/pos/orders/[id]/void` ·
`/api/pos/orders/[id]/refund` · `/api/pos/sessions/open|close` ·
`/api/pos/inventory/movements` · `/api/pos/inventory/counts/[id]/apply` ·
`/api/pos/healthbox/expenses` · `/api/pos/healthbox/expenses/[id]/approve` ·
`/api/pos/settlements` · `/api/pos/verify-pin` · `/api/pos/members/lookup` (narrow fields).

All re-verify role server-side; all mutating routes write `activity_logs`.

---

## 7. Components — reuse, extend, build new

### 7.1 Small additive extensions to existing components

| Component | Extension | Backwards-compatible? |
|-----------|-----------|----------------------|
| `Button` | Add `size="touch"` (min-height 64px, larger type) and `size="touch-lg"` (96px, the PAY button) | Yes — new union members, existing call sites unaffected |
| `Badge` | Add variants `sold_out`, `low_stock`, `in_stock`, `held`, `voided`, `refunded`, `completed`, `draft`, `paid` | Yes — additive to the variant map |

Nothing else needs modifying.

### 7.2 `PaymentSplitRows` — reuse the logic, not the layout

`validatePaymentSplit()` and `splitTarget()` are pure and directly reusable. The **UI is
not** — it is a compact form with `Select` dropdowns and a "partial payment" toggle. The
POS payment sheet needs full-screen method tiles and a numeric keypad, and POS sales are
paid in full (no partial).

**Plan:** extract the pure helpers into `src/lib/pos/payment.ts` (or import them directly),
and build a separate touch payment sheet. Do **not** modify `PaymentSplitRows` — it serves
three live fee-collection surfaces.

**Note:** its `PAYMENT_METHODS` constant is `["Cash","Bank","Card","EasyPaisa","JazzCash"]`
— the gym uses **"Bank"**, while spec §10 says **"Bank Transfer"**. POS should use its own
constant. Do not rename the gym's; it is a stored CHECK value across historical rows.

### 7.3 New POS components

Terminal: `PosShell`, `DepartmentRail`, `CategoryStrip`, `ProductGrid`, `ProductTile`,
`ModifierSheet`, `CartPanel`, `CartLine`, `QtyStepper`, `MemberPicker`, `DiscountSheet`,
`PaymentSheet`, `NumericKeypad`, `QuickCashButtons`, `HeldOrdersDrawer`,
`RecentOrdersDrawer`, `ReceiptView`, `SessionOpenModal`, `SessionCloseModal`,
`ManagerPinPrompt`, `ConnectionBanner`.

Admin: `ProductForm`, `ModifierGroupEditor`, `StockMovementTable`, `ReceiveStockForm`,
`StockCountSheet`, `LowStockList`, `HealthBoxExpenseForm`, `ExpenseApprovalQueue`,
`SettlementSummary`, `SettlementHistory`, `DepartmentBreakdownChart`.

---

## 8. File-by-file plan

### 8.1 Existing files that change (all additive)

| File | Change | Risk |
|------|--------|------|
| `src/app/dashboard/page.tsx` | **Add `cashier` and `healthbox_staff` branches** before the owner fallthrough | **Critical** — B1 |
| `src/components/layout/Sidebar.tsx` | Add all POS routes to `NAV_ROLES`; add the "POS & Inventory" nav group with children | **High** — B2 |
| `middleware.ts` | Guard `/pos` and `/api/pos`; role-aware post-login redirect | **High** — B3 |
| `src/app/dashboard/layout.tsx` | Redirect `cashier` → `/pos`, `healthbox_staff` → HealthBox landing | Medium |
| `src/types/database.ts` | Add both roles to `SystemRole`; add 15 table interfaces + `Database` map entries | Low |
| `src/app/api/upload/photo/route.ts` | **Add an auth + role check** (currently open to the internet with a service-role key) | **Security prerequisite** |
| `src/app/api/upload/document/route.ts` | Same | **Security prerequisite** |
| `src/app/dashboard/reports/page.tsx` | Add POS report types to the `ReportType` union and switch | Medium — touches a live page |
| `src/app/dashboard/members/[id]/page.tsx` | Add a POS purchase-history tab (read-only) | **High** — 2,858 lines, most fragile file in the app. Phase H, last. |
| `src/app/globals.css` | Add POS-scoped touch rules under a `.pos-root` class | Low — must not leak to the dashboard |
| `src/components/ui/Button.tsx` | Add two size variants | Low |
| `src/components/ui/Badge.tsx` | Add nine variants | Low |
| `CLAUDE.md` | Document the new tables, roles and rules | Low |

### 8.2 New files

```
supabase/migrations/     ~18 files (RLS baseline first, then POS tables + policies)
src/app/pos/             layout.tsx, page.tsx  + terminal components
src/app/r/[order_no]/    page.tsx              (public receipt)
src/app/dashboard/pos/   ~17 admin pages
src/app/api/pos/         ~12 route handlers
src/components/pos/      ~20 terminal components
src/components/pos/admin/ ~11 admin components
src/lib/pos/             catalog.ts, cart.ts, pricing.ts, payment.ts,
                         orderNumber.ts, inventory.ts, settlement.ts, permissions.ts
src/types/pos.ts         POS-specific view models
src/hooks/               usePosSession.ts, useCart.ts, useHeldOrders.ts
```

### 8.3 Explicitly untouched

`src/lib/commission.ts` · `extendExpiryDate()` and `groupPaymentsByReceipt()` in
`src/lib/utils.ts` · `src/components/forms/PaymentSplitRows.tsx` ·
`src/components/forms/registration/**` · `src/app/api/attendance/**` · `src/app/iclock/**` ·
`relay-service/**` · `src/app/dashboard/fees/**` · `src/app/dashboard/commissions/**`.

---

## 9. Risk and conflict review

### 9.1 Conflicts needing a decision

**C4–C15 live in [`phase3-figma-reconciliation.md`](./phase3-figma-reconciliation.md) §5.**
The three below are the originals; C1 is now closed.

| # | Conflict | Detail |
|---|----------|--------|
| ~~C1~~ | ~~Figma unreadable~~ | **RESOLVED 8 Sep** — token added, all 22 frames reviewed. See §0. |
| **C2** | **Member Account / Tab** | On 6 Sep, "charge to member account" was confirmed in scope. This spec's §10 lists confirmed methods as Cash / Card / Bank Transfer / EasyPaisa / JazzCash — **no Member Account** — and §10 says only "do not assume it is available *for HealthBox*". Two readings: (a) tabs allowed for Level Up departments, forbidden for HealthBox; (b) tabs dropped entirely this phase. I have **excluded** tabs from the schema above pending one word from you. Adding them later is additive. |
| **C3** | **RLS is a hard prerequisite, not a parallel task** | Spec §30 says enforce with "the existing server/database authorization architecture" and "RLS if present". **It is not present.** Giving a third party's staff a login to a database where the anon key reads everything is not safely mitigable in application code. The staged migrations must be applied before HealthBox accounts exist. |

### 9.2 Regression risks

| # | Risk | Mitigation |
|---|------|------------|
| R1 | New role falls through to the owner dashboard (B1) | Add branches first, verify by logging in as each role before anything else ships |
| R2 | New route visible to all roles (B2) | Explicit `NAV_ROLES` entry per route; checklist at review |
| R3 | `/pos` unauthenticated (B3) | Extend the middleware matcher and guard in Phase A |
| R4 | Editing `reports/page.tsx` or `members/[id]/page.tsx` breaks a live screen | Additive tabs only; schedule both last (Phases G, H) |
| R5 | Migration applied out of order with a deploy | Every POS release is: apply migration → verify in Studio → then deploy. Never the reverse. |
| R6 | POS touch CSS leaking into the dashboard | Scope all of it under `.pos-root`, never bare element selectors |
| R7 | Supabase 1,000-row silent truncation on POS reports | Use `fetchAllRows<T>()` for every aggregate |
| R8 | `stock_qty` cache drifting from the movement ledger | A reconciliation query in the QA phase; movements are the source of truth |
| R9 | Product image upload inheriting the open upload route | Fix the auth gap before Phase D |

---

## 10. Staged implementation with checkpoints

| Stage | Scope | Checkpoint before proceeding |
|-------|-------|------------------------------|
| **A0** | Apply the staged RLS baseline (20 existing migrations) | Every existing page works, logged in as each of the 5 current roles. This is a **standalone release** — nothing POS ships with it. |
| **A1** | Fix `/api/upload/*` auth | Upload still works from registration; an unauthenticated POST is rejected |
| **A** | Two new roles; `SystemRole`; `dashboard/page.tsx` branches; `layout.tsx` redirects; `middleware.ts`; `NAV_ROLES`; `pos_settings`; scope + PIN columns | Log in as cashier → lands on a placeholder `/pos`, **cannot** reach `/dashboard/fees` or see the owner dashboard. Log in as healthbox_staff → scoped landing only. All 5 existing roles unchanged. |
| **B** | POS tables + RLS; catalogue API; terminal — departments, categories, grid, cart, modifiers, member lookup, member pricing, discounts, held orders, payment sheet, split payment, completion | A cashier completes a mixed-basket sale. `cost_price` absent from every network response. Member pricing applies both ways. |
| **C** | Orders admin, register sessions, void and refund with manager PIN, digital receipt, public receipt route, recent orders | Void requires a PIN; a voided order survives with its reason; a refund nets out; variance computes correctly |
| **D** | POS Admin — departments, categories, products, modifiers, suppliers, images | Full catalogue CRUD; a HealthBox staff account sees only HealthBox products |
| **E** | Inventory — receive, adjustments, counts, movements, low-stock alerts | A sale decrements stock; a count produces `count_correction` movements, never an overwrite; `stock_qty` matches `SUM(qty_delta)` |
| **F** | HealthBox restricted management + expenses with approval and attachments | HealthBox staff can submit an expense and cannot approve it, cannot see settlement, cannot touch Level Up departments |
| **G** | Owner dashboard extension, POS reports, HealthBox settlement | Settlement maths verified by hand for one period, including a **deliberate loss period** to confirm §20 |
| **H** | Member profile POS purchase-history tab; combined revenue view | Membership payment history is byte-identical to before |
| **I** | QA — permissions matrix, reconciliation, regression | Full regression across registration, fees, commissions, attendance, reports |

**Regression suite to run at every stage:** register a member (public and staff paths);
collect a fee with a split payment; collect a partial and settle the balance; take a
multi-month advance and verify `expiry_date`; verify a trainer commission for a PT member;
confirm a device punch still records; open `/dashboard/reports` and compare revenue totals
against the previous stage.

---

## 11. Questions

Only where the answer cannot be derived from the spec, the codebase, or the Figma.

| # | Question | Blocks |
|---|----------|--------|
| ~~Q1~~ | ~~How do I get the Figma?~~ | **RESOLVED 8 Sep.** |
| **Q1b** | **Does the terminal have a physical keyboard?** The approved member picker, product search and kitchen-note field all require typing (C5). If there is no keyboard, I add an on-screen one. | Phase B |
| **Q1c** | **Is a barcode scanner actually being bought?** (C4.) The terminal has a `Scan barcode` button. A USB POS scanner acts as a keyboard, so this is cheap to support — but I need to know whether to wire it. | Phase B |
| **Q1d** | **Order number format** — keep the Figma's `#LU-1042`, or the dated `LUP-YYYYMMDD-NNNN`? (C12.) It appears on every receipt. | Phase B |
| **Q1e** | **HealthBox accent colour.** Owner charts need third-party revenue visually distinct from Level Up's. The Figma uses purple, which sits badly next to `#F06418`. I'd suggest a muted teal or slate. | Phase G |
| **Q2** | **Member Account / Tab — in or out?** (C2 above.) Confirmed in scope on 6 Sep; absent from this spec's confirmed payment methods. I have left it out. One word settles it. | Phase B |
| **Q3** | **May I apply the staged RLS migrations as stage A0?** This touches production authorization and is the one item where I will not proceed without explicit approval, separately from approving this plan. | Everything |
| **Q4** | **Cashier discount ceiling and void window** — what percentage can a cashier apply unaided, and for how long after a sale can an order be voided? These go in `pos_settings`, so defaults are fine and changeable later. | Phase C |
| **Q5** | **HealthBox settlement period start** — monthly is confirmed as default. Calendar month, or a fixed day-of-month cycle (e.g. the 26th to the 25th)? | Phase G |

Everything else in the specification is unambiguous and I have taken it as frozen.

---

**No files, schema, routes or behaviour have been modified. Awaiting your approval.**
