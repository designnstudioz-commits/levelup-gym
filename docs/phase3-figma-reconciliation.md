# Phase 3 — Figma Reconciliation

**Source:** `Level Up POS — Phase 3` (file key `p62u2Rb9XsC26iIqYgnGVI`), last modified 8 Sep 2026.
**Read via:** Figma REST API, all 22 frames rendered and reviewed.
**Purpose:** replace the assumptions in `phase3-audit.md` §0 with what the approved UX actually shows.
**Status:** audit only. Nothing modified.

---

## 1. Frame inventory

| Page | Frames |
|------|--------|
| 01 Cashier POS | Cashier POS — Main Terminal |
| 02 HealthBox POS | HealthBox Department — POS |
| 02 Cashier Flow | 01 Product Modifiers · 02 Member Selection · 03 Payment · 04 Split Payment · 05 Sale Complete · 06 Held Orders · 07 Recent Orders |
| 03 POS Admin + Inventory | Overview · Product Catalog · Add/Edit Product · Inventory Overview · Receive Stock · Stock Adjustment · Low Stock Alerts · Suppliers |
| 04 Owner & Reports | Owner Dashboard · Daily Business Report · HealthBox Financial & Settlement · Inventory Report · Cashier / Shift Report |

All frames are **1440 × 1024**, not 1920 × 1080. The design is drawn for a 1440-wide
viewport. Two frames carry explicit draft notes: *"UX DRAFT v1 — structure first, visual
brand can be refined after approval"* and *"Sample figures for UX approval — production
values will come from live data."*

---

## 2. Terminal structure — confirmed

The three-zone layout I proposed is correct, with these exact contents:

**Top bar.** `LEVEL UP [POS]` lockup · "Cashier Terminal" · right side: `SHIFT OPEN` pill,
cashier name + role, time and date.

**Left rail (~185px).** `DEPARTMENTS` — All Items, Supplements, Level Up Cafe, Accessories,
HealthBox, **each with a live product count**. Active item is a filled dark block. Then
`QUICK ACCESS` — ★ Favourites, ⏱ Held Orders (with count), ↻ Recent Sales. Pinned at the
bottom: a **"Current shift — Rs 32,450 / 24 orders"** card.

**Centre.** Department title + subtitle · search input · **"Scan barcode" button** · overflow
`⋯` · `CATEGORIES` pill row · a **"Quick Sellers — Most purchased today"** section · 4-column
product grid. Tiles carry name, price and a status badge: `Popular`, `Member`, `Low`,
`Sold out`.

**Right panel (~400px).** "Current Order" + order ref · customer card (avatar, "Walk-in
Customer", "Add member for member pricing", `Add Member` button) · item count · line rows
with department subtitle, `−  qty  +` stepper and an `Edit` link · `Hold Order` / `Clear` /
`Discount` · Subtotal / Discount / **Total** · large `PAY` button showing the amount · a
"Fast checkout — Cash • Card • EasyPaisa • JazzCash • Split" hint strip.

**HealthBox department** uses the same shell. Tiles show the ingredient line and an
`Available` badge; cart lines show `Edit options` instead of `Edit`.

---

## 3. Screen-by-screen findings that change the plan

### 3.1 Product modifiers

Full-screen, two-panel. Left: product card with department label, "Includes" ingredient
list, and a quantity stepper. Right: **numbered** modifier groups —

1. **Sauce** — "Choose 1", radio, required
2. **Toppings** — "Optional • Select up to 4", multi-select chips
3. **Add-ons** — chips
4. **Special note** — free text, *"Tap to add a short kitchen note…"*

Footer shows a live "Selections: Dynamic • Cheese • Jalapeño • Sweet Corn" summary, then
Cancel / Add to Cart.

> **Schema change.** Groups need `sort_order`, `selection_type`, `is_required`,
> `min_select`, `max_select` — all of which I had. **What I missed is a per-line note.**
> `pos_order_items` needs `item_note TEXT` for the kitchen note. My schema only had a note
> on the order header.

### 3.2 Member selection

Full-screen card. **A text search box** — *"Search by name, phone or member ID"* — over a
`RECENT MEMBERS` list. Each row: avatar, name, `Active • M-2048`, and a computed pill:

| Pill | Meaning |
|------|---------|
| `Member pricing available` | at least one item in the **current cart** has member pricing |
| `No special price on cart` | member is valid, but nothing in this cart is discounted |
| `Membership expired` | red, expired member |

Actions: `Continue as Walk-in` · `Cancel` · `Use Selected Member`.

> **Two findings.** First, the pill is **cart-aware** — it is computed against the current
> basket, not a static member attribute. That is a nice touch and needs implementing as
> such. Second, **the design assumes typing.** My audit proposed an A–Z rail specifically
> because there is no keyboard. See conflict C5.

### 3.3 Payment

Two-panel. Left: Order Summary card with lines, subtotal, "Total due", customer chip.
Right: **six method tiles** in two columns — Cash, Card, Bank Transfer *(Record transfer
reference)*, EasyPaisa, JazzCash, and **Split Payment as its own tile** *(Use two or more
methods)*. Below: a "Cash received" display and a **numeric keypad** — 1–9, `00`, `0`,
backspace. Back / Complete Payment.

> Split is a **method choice, not a mode toggle**. There are **no quick-cash buttons**
> (Exact / 500 / 1000 / 5000) — I proposed those; they are not in the approved UX. See C14.

### 3.4 Split payment

Header strip: `Total due Rs 5,000` | `Remaining Rs 3,000` (red). Then `PAYMENT 1` — Cash
Rs 2,000, `PAID` badge, `Edit`. `PAYMENT 2` — method chips + amount. `+ Add another
payment`. Cancel / Complete Split Payment.

> **Cash is absent from the Payment 2 chip row** because it was used in Payment 1 —
> already-used methods are excluded from subsequent split rows.

### 3.5 Sale complete

Success card: checkmark, "Payment successful", order ref, then `Total Paid` / `Payment` /
`Change`. Buttons: `View Receipt` · `New Sale`. Footnote: *"Receipt can be shown digitally
using the order QR."* — confirms the QR receipt approach.

### 3.6 Held orders

Rows of `#H-021` · customer · "3 items • 5 min ago" · amount · `Delete` / `Resume`.
Footnote: *"Held orders remain editable until payment is completed."*

> **Held orders carry their own reference series (`#H-021`)**, separate from completed
> order numbers (`#LU-1042`). `Delete` on a held order should be a soft delete
> (`deleted_at`) — it has no financial record, but house rules still forbid hard deletes.

### 3.7 Recent orders

Table: ORDER / CUSTOMER / TIME / PAYMENT / TOTAL, with `View` and **`Refund`** per row.
Filter chips All / Cash / Card. Split payments render as `Cash + Card`. Scope is
*"Completed sales from the current shift."* Amber banner: **"Refunds and voids require
manager approval."**

> **Permissions refinement.** The Refund button is present in the **cashier's** UI. So a
> cashier **initiates** a refund and a manager **authorises** it via PIN. My audit had
> refund as manager-only, which would have hidden the button entirely. See C9.

### 3.8 POS Admin — Add Product

Fields: Product Name · Department · Category · **Financial Owner / Vendor** · Brand ·
**SKU / Barcode (one combined input)**. Pricing: Regular Selling Price · **Member Pricing
Model ("Fixed price / Percentage / None")** · Member Price / Discount. Inventory: Track
Stock toggle · Current Stock · Low Stock Alert · Unit. POS Availability: chips `ACTIVE`,
`SHOW ON POS`, `MEMBER PRICING`.

> **Three findings.**
> 1. **Member Pricing Model is an explicit three-way field** — exactly the
>    `member_price_type` enum I proposed. Confirmed.
> 2. **`ACTIVE` and `SHOW ON POS` are separate flags**, plus availability elsewhere. That is
>    **three** states, not two. `pos_products` needs `show_on_pos BOOLEAN` in addition to
>    `is_active` and `is_available`.
> 3. **There is no Cost Price field on this form** — because the frame is drawn for the
>    "POS Admin — operational access only" role. Cost must exist but be owner/manager-only.
>    See C10.
>
> Helper text on this screen mentions *"recipe inventory"* for HealthBox. **Spec §16
> explicitly forbids BOM/recipe depletion this phase.** Spec wins — see C11.

### 3.9 Receive Stock

Header: **Supplier · Received Date · Reference / Invoice**. Then an `Items Received` table —
Product / Qty / Unit Cost / Total Cost / Remove — with `+ Add Item`, and a total received
quantity. Panel text: *"Posting this receipt creates immutable stock movement entries for
each product. Current stock is increased automatically; prior movement history remains
unchanged."*

> **Schema change.** This is a **document with a header and many lines**. My flat
> `pos_stock_movements` table cannot represent "one receipt, one supplier, one invoice
> reference, five products". Needs a `pos_stock_receipts` header table, with each line
> emitting a `purchase` movement that references it.

### 3.10 Stock Adjustment

Product · Current Stock · Adjustment (`−2`). Reason chips: **Damage · Expiry · Wastage ·
Loss / Theft · Internal Use · Physical Count**. Notes field marked *"Required for audit
trail…"*. Live preview: **"Current stock: 4 → New stock: 2"**.

> Confirms the movement-ledger model. **Notes are mandatory on adjustments.** The six chips
> are the manual subset of the eleven movement types in spec §15 — the rest
> (`opening`, `purchase`, `sale`, `customer_return`) originate from other flows.

### 3.11 POS Admin Overview

Stat tiles: Active Products · Low Stock · Out of Stock · Stock Movements Today. Then
Department Status (per-department product count + low-stock badge), a Recent Inventory
Activity feed, and an "Attention Required" panel with chips `8 LOW STOCK`,
`3 OUT OF STOCK`, **`2 COUNTS DUE`**.

> **"Counts due" implies scheduled stock counts** — a recurrence or due-date concept my
> schema does not have. `pos_stock_counts` needs a `due_date` (and probably a
> `scheduled_for` / cadence) if this tile is to be real.

### 3.12 Owner Dashboard

Tiles: **Membership Collection · POS Sales · Total Collected (Membership + POS) · Cash
Variance**. Then:
- **POS Sales by Department** — horizontal bars; HealthBox is rendered in a distinct colour
  to mark it as the third-party owner
- **Needs Attention** — low stock, out of stock, HealthBox expenses pending approval, open cash shifts
- **HealthBox — Current Month** — Net Sales, Approved Costs & Expenses, Net Profit, Level Up
  Share, HealthBox Share, settlement cycle, pending-approval count
- **Payment Mix — Today** — amount and percentage per method

This is exactly the §26 integration list, and every figure is derivable from the proposed
schema.

### 3.13 HealthBox Financial & Settlement

Tiles: **Net Sales** *(after customer discounts)* · **COGS** *(approved cost of goods)* ·
**Operating Expenses** *(approved salaries + direct costs)* · **Net Profit** *(ready for
50/50 split)*.

Profit Split panel prints the formula: **"Net Sales – approved COGS – approved operating
expenses = Net Profit"**, with a 50/50 bar.

Settlement panel: `MONTHLY` badge · current period · HealthBox payable · Status
**"DRAFT — 3 PENDING EXPENSES"** · `Review expenses` / `Prepare settlement` · note that
*"Cycle can remain configurable; monthly is the current default."*

Expenses table: Date / **Type** / Description / Amount / **Entered By** / Status / Action.
Types seen: **COGS, Salary, Operating, Other**. Entered By shows both **HealthBox** and
**Level Up**. Status: Approved / Pending.

Footer: *"Only approved expenses are included in settlement calculations. Cashiers never see
this financial split."*

> **Three findings.**
> 1. `pos_healthbox_expenses.category` is a real enum: `cogs | salary | operating | other`.
>    COGS and operating are **reported separately**, so it cannot be free text.
> 2. **Level Up staff can also enter HealthBox expenses** (the "Stall repair" row). My
>    schema's `submitted_by` covers this; the "Entered By" column derives from the
>    submitter's role.
> 3. **A settlement cannot be finalised while expenses are pending.** The status literally
>    reads "DRAFT — 3 PENDING EXPENSES". This is a hard gate to encode.

### 3.14 Cashier & Shift Report

Tiles: Open Shifts · Closed Today · Cash Variance · **Manager Actions (refund/void
approvals)**. Table: Cashier / Shift / Orders / POS Sales / **Expected Cash / Counted Cash /
Variance** — an open shift shows `—` and `Open`. Then a per-shift **Payment Mix** panel, and
an **Exceptions & Approvals** panel: Type / Order / Value / Status, with rows for `Refund`,
`Void` and **`Discount > limit`**, badged `MANAGER CONTROLLED`.

The reconciliation rule is printed on the frame:

> **"Opening cash + cash sales – cash refunds = expected cash. Cashier enters counted cash
> at close; the system records variance and keeps the session immutable after manager
> review."**

> **Two schema changes.**
> 1. My `expected_cash` definition was "opening + cash sales − payouts". The approved rule
>    is **minus cash refunds**. Correcting that.
> 2. **A session becomes immutable after manager review** — `pos_register_sessions` needs
>    `reviewed_by`, `reviewed_at` and a lock, which I did not have.
> 3. **Exceptions are a first-class reportable entity.** Refunds, voids and over-limit
>    discounts appear in one list with a status. Tracking authorisation on the order alone
>    cannot produce this table cleanly — it needs a `pos_approvals` table.

---

## 4. Schema deltas from the audit

Additions and corrections to `phase3-audit.md` §5.

| # | Change | Source |
|---|--------|--------|
| D-01 | `pos_order_items.item_note TEXT` — kitchen / special note per line | Modifiers screen |
| D-02 | `pos_products.show_on_pos BOOLEAN` — third flag alongside `is_active` and `is_available` | Add Product |
| D-03 | `pos_products.financial_owner` override — the form exposes Financial Owner as its own field, not derived from department. Default from department, editable by owner only. | Add Product |
| D-04 | **New table `pos_stock_receipts`** — supplier, received_date, reference/invoice, posted_by. Movements link to it. | Receive Stock |
| D-05 | **New table `pos_approvals`** — type (`refund`/`void`/`discount_over_limit`), order_id, value, requested_by, approved_by, status. Drives the Exceptions panel. | Cashier & Shift Report |
| D-06 | `pos_register_sessions` + `reviewed_by`, `reviewed_at`, `is_locked` | Cashier & Shift Report |
| D-07 | `expected_cash` = opening + cash sales **− cash refunds** (was "− payouts") | Cashier & Shift Report |
| D-08 | `pos_healthbox_expenses.category` enum `cogs \| salary \| operating \| other` | HealthBox Financials |
| D-09 | Settlement finalisation **blocked** while any expense in the period is `pending` | HealthBox Financials |
| D-10 | `pos_stock_counts.due_date` — the "2 COUNTS DUE" tile implies scheduling | POS Admin Overview |
| D-11 | Held orders need their own `hold_ref` series (`#H-021`) distinct from `order_no` | Held Orders |
| D-12 | Member-pricing pill is **cart-aware** — computed against the current basket, not a member attribute | Member Selection |
| D-13 | "Quick Sellers — most purchased today" is a computed section on the terminal | Main Terminal |
| D-14 | Favourites needs storage — per-cashier or global. Not in the written spec. | Main Terminal |
| D-15 | Department rail shows a live product count per department | Main Terminal |

Revised table count: **17** (was 15) — adding `pos_stock_receipts` and `pos_approvals`.

---

## 5. New conflicts

Added to `phase3-audit.md` §9. C1 (Figma unreadable) is now **resolved**.

| # | Conflict | My reading |
|---|----------|------------|
| **C4** | **Barcode scanning.** The terminal has a prominent `Scan barcode` button, and the product form has a SKU/Barcode field. My earlier scope said no scanner. Spec §14 hedges — "Barcode if supported". | Build the **field and the button**, wire the button to accept keyboard-wedge scanner input (which is how USB POS scanners work — they type). No special hardware integration needed. Confirm a scanner is actually being bought. |
| **C5** | **The member picker types.** The approved UX uses "Search by name, phone or member ID". My audit avoided typing because a touch monitor has no keyboard. | Either the terminal has a physical keyboard, or we add an on-screen keyboard to this one screen. **Needs your answer** — it also affects the product search box and the kitchen-note field. |
| **C6** | **Separate app shells.** POS Admin and Owner frames each have their **own dark sidebar** with their own nav. Spec §3, §14 and §26 all say integrate into the existing dashboard and do not replace the Owner Dashboard. | **Spec wins** — the Figma sidebars become the "POS & Inventory" nav group inside the existing sidebar. Flagging because it is a visible divergence from the approved frames. |
| **C7** | **"POS Admin" is not one of our roles.** The frames show a role called *POS Admin — operational access only*. | Maps to `manager`. No new role. |
| **C8** | **Cashier sees shift totals.** The terminal shows the cashier "Current shift Rs 32,450 / 24 orders". My audit had daily totals as owner/manager-only. | Refine: a cashier sees **their own open session's** takings, which they need in order to count the drawer. They never see business-wide totals, other cashiers, cost or margin. Consistent with spec §12 and §25. |
| **C9** | **Refund button is in the cashier UI.** | Refine the matrix: cashier **initiates**, manager **authorises** by PIN. Not manager-only. |
| **C10** | **No Cost Price on the Add Product form**, but spec §14 requires it and HealthBox COGS depends on it. | The field exists; it is hidden from the operational role. Visible to owner/manager only, filtered **server-side**. |
| **C11** | **"Recipe inventory"** appears in helper text on the product form. Spec §16 forbids BOM/recipe depletion this phase. | Spec wins. Ignore the helper text. |
| **C12** | **Order number format.** Frames show `#LU-1042` — a simple running sequence. I proposed `LUP-YYYYMMDD-NNNN`. | Recommend keeping the Figma's `LU-####` for the customer-facing label and storing a full internal reference. Or adopt `LU-####` outright. **Your call** — it is cosmetic but it is on every receipt. |
| **C13** | **Member ID shown as `M-2048`.** Real format is `LUM-YYYY-NNNN` / `LUF-YYYY-NNNN`. | Figma is illustrative. Use the real format. |
| **C14** | **No quick-cash buttons** on the payment keypad. I proposed Exact / 500 / 1000 / 5000. | Not in the approved UX. I will **not** add them unless you want them — it is a genuine speed win but it is a change to an approved screen. |
| **C15** | Frames are **1440 × 1024**, not 1920 × 1080. | Build fluid so it fills a 1920 monitor without stretching the design's proportions. Still need the actual hardware spec (Q10). |

---

## 6. Design system mapping

The frames use black `#111` for active states and primary buttons, with a light green
accent for positive badges (`SHIFT OPEN`, `Available`, `Popular`) and purple for HealthBox
on the owner screens. Per the frozen visual rule, these map onto the existing Level Up
system as:

| Figma | Implementation |
|-------|----------------|
| Black filled primary button (`PAY`, `Save Product`) | `#F06418` orange, white text — the existing primary `Button` at touch size |
| Black filled active nav / category pill | `#F06418` on white, or `#FEF0E8` + `#F06418` text for the sidebar, matching current `Sidebar` active state |
| Terminal top bar / admin sidebar | `#1A1A1A`, matching the existing dashboard sidebar |
| Light green positive badge | Existing `Badge variant="active"` (green-50/green-700/green-200) |
| Amber warning banner | Existing `Badge variant="partial"` palette (amber-50/amber-700) |
| Red destructive / expired | Existing `Badge variant="rejected"` (red-50/red-700) |
| Purple HealthBox accent | **Needs a decision.** HealthBox must be visually distinguishable from Level Up departments on owner charts. Options: keep a single non-brand hue for third-party ownership, or use `#1A1A1A` against orange. Recommend a muted teal or slate rather than purple — purple sits oddly beside `#F06418`. |
| Card, radius, borders | Existing `Card` — `bg-white border border-[#E4E4DE] rounded-xl` |
| Stat tiles | Existing `StatsCard` |

The one place the frames introduce something the design system has no answer for is the
**third-party ownership colour**. Everything else maps cleanly.

---

## 7. What this does not change

The core architecture calls in `phase3-audit.md` all survive contact with the Figma:

- Separate `/pos` full-screen route outside the dashboard layout — confirmed by every terminal frame
- POS finance in dedicated `pos_*` tables, never `fee_payments` — confirmed by the Owner Dashboard showing Membership and POS as separate figures that sum to a combined total
- Line-level financial ownership — confirmed by POS Sales by Department and the HealthBox settlement
- Period-level HealthBox settlement, not per-line commission — confirmed, formula printed on the frame
- Immutable orders, void preserves the record, refund creates a linked negative — confirmed by the Exceptions panel
- Movement-ledger inventory that never overwrites quantities — confirmed twice, in the panel text on both Receive Stock and Stock Adjustment

---

**Still awaiting approval. Nothing modified.**
