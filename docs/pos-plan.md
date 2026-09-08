# Level Up Fitness Club — Cafe POS System
## Phase 3 Plan

*Drafted September 2026. Status: **plan for review** — nothing built yet.*

---

## 1. The operating picture

Level Up has a cafe on site. Two parties sell through it:

| Seller | What they sell | Money flow |
|--------|----------------|------------|
| **Level Up (house)** | Supplements, protein shakes, water, merch | 100% gym revenue |
| **The vendor** | Cafe food & drinks | **Commission split** — gym keeps a % of each sale (the % itself still needs sign-off, Q1) |

One customer can buy from both in a single order (a protein shake + a sandwich). The POS
must handle a **mixed basket** and split it correctly at the line level — this is the
single most important structural requirement, and it drives most of the data model.

**Constraints given:**
- Runs on a **touch monitor** — big buttons, no mouse, **no physical keyboard**
- **No barcode scanner** — everything is tap-to-select from a visual grid
- **No printer** — receipts are digital only
- **All finances surface in the gym dashboard, admins only**

### Decisions confirmed (6 Sept 2026)

| # | Decision | Effect on the build |
|---|----------|---------------------|
| Q1 | **Commission split** with the vendor | `settlement_model='commission'`; settlement module is in scope. Percentage still TBD — see Q1b |
| Q3 | **Dedicated cafe staff** operate the POS | New `cashier` role added to `system_users`; see §8 |
| Q4 | **Tag the member** on the sale | `pos_orders.member_id` used in Phase 3A; per-member purchase history |
| Q5 | **Member pricing** | `pos_products.member_price` used in Phase 3A |
| Q6 | **Charge to member account** (tab) | In scope — Phase 3B, shipped together with its settlement path (§10) |
| Q9 | **PRA / tax invoicing out of scope** | No tax fields, no e-IMS integration. Recorded as an accepted risk in §12 |

Still open, none of them blocking: Q1b (the actual %), Q1c (who absorbs a member discount),
Q2, Q6b (tab limit), Q7, Q8, Q10, Q11 — see §11.

---

## 2. What the research says good POS systems do

Condensed from current POS/UX practice and applied to this build.

**Interaction**
- **Three-tap rule** — any function reachable in 3 taps or fewer. A common item should be 2 taps: item, then PAY.
- **Touch targets**: WCAG 2.5.5 (AAA) sets 44×44 CSS px as the floor; Apple recommends 44pt, Android 48dp. Fixed kiosks are advised to go to **12–15mm physical**. Targets under 44px show roughly **3× the error rate**. We go well above the floor (§6).
- **No hover-dependent UI.** Touch has no hover. Every affordance must be visible at rest, with a pressed state for feedback.
- **Consistent placement and colour coding** — destructive controls always red, always in the same spot. Staff build muscle memory; moving things later costs real money in mis-taps.
- **Validate only where it matters.** Blocking on every field slows the queue.

**Money controls**
- Voids and discounts above a threshold need **manager authorisation**, not a free-for-all.
- Every sensitive action lands in an **audit trail**, attributed to a staff member.
- **Shift close / Z-report**: count the cash, compare to what the system says, record the variance. This is the primary theft-and-error control in any cash business.
- Payments are an **immutable ledger** — never edit a completed sale. Corrections are new rows that reverse the old ones, so any historical report stays reproducible.

**Multi-vendor**
- Automatic commission split per line, a per-vendor ledger the vendor can be shown, and **one-click settlement** for a period instead of hand-calculated payouts. Hand calculation is where multi-vendor arrangements go wrong.

**Reliability**
- Offline capability matters more than most features — a POS that can't take an order stops the business. Local-first write, background sync, and *surface conflicts, never silently drop*.
- Test against a **flaky** connection, not a clean on/off toggle. Intermittent is what actually happens.

---

## 3. Architecture decisions

### 3.1 A separate `/pos` route, not a dashboard page

The POS gets its own full-screen layout at **`/pos`**, outside `src/app/dashboard/layout.tsx`.

*Why:* the dashboard layout ships a 240px sidebar of small links and dense tables. On a
touch monitor that is wasted space and a source of accidental navigation out of a
half-finished sale. The POS wants full-bleed, three-zone, no chrome.

Admin and finance screens stay in the dashboard where they belong:
`/dashboard/pos/products`, `/dashboard/pos/vendors`, `/dashboard/pos/reports`,
`/dashboard/pos/settlements`, `/dashboard/pos/sessions`.

### 3.2 Do **not** write cafe sales into `fee_payments`

This is the most important "don't" in the plan.

`fee_payments` carries a delicate convention (`PROJECT_HANDOFF.md` §5): one logical payment
split across methods becomes **multiple rows sharing a `receipt_no`**, with `balance_due`,
`commission_*`, `months_covered` and `package_breakdown` set **only on the first row**.
Every existing report, commission calculation and member balance depends on that shape.
Pushing cafe sales through it would corrupt membership revenue reporting and trainer
commissions.

Cafe sales live in their own `pos_*` tables. The dashboard then presents a **combined
revenue view** that reads from both sources — union at the *reporting* layer, never at the
storage layer.

### 3.3 Server-side enforcement from day one

The handoff doc records that most existing pages are protected by **sidebar visibility
only** — a direct URL bypasses them — and that the RLS migrations written in August are
staged but not yet applied.

POS is a cash-handling module and should not inherit that pattern:
- All order writes go through **API routes** (`/api/pos/*`) that re-check the caller's role
  server-side, the way `api/admin/create-user` already does.
- Ship **RLS policies alongside the POS migrations**, using the existing
  `current_role_in(ARRAY[...])` helpers from `20260825100000_rls_helper_functions.sql`.
- Cost prices, margins and totals must be *server-filtered*, not merely hidden in the UI.

### 3.4 Orders are immutable once completed

An order moves `open` → `completed`. After `completed`, its lines and totals never change.
- **Void** (same day, before settlement) sets `status='voided'`, keeps every row, and requires manager auth plus a reason.
- **Refund** creates a new linked order with negative quantities, so the ledger nets out and history stays intact.

This follows the immutable-ledger pattern and matches the project's existing "never hard
delete" rule.

### 3.5 Snapshot everything on the line item

`pos_order_items` stores `product_name`, `unit_price`, `cost_price`, `vendor_id` and
`gym_share_percent` **as copies at time of sale**, not just foreign keys.

*Why:* prices change, products get renamed, and a product could move between vendors. A
settlement report run in December for August must reproduce August's numbers exactly. This
is the same instinct already used in `fee_payments.package_breakdown`.

---

## 4. Data model

New tables, all following house rules: `deleted_at` soft delete, additive-only columns, one
timestamped file per migration in `supabase/migrations/`, and an `activity_logs` row on
every meaningful action.

```sql
-- ── Vendors ──────────────────────────────────────────────────────────
-- Seeded with two rows: Level Up (is_house=true) and the cafe vendor.
CREATE TABLE pos_vendors (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  code                TEXT UNIQUE,              -- short tag on reports, e.g. 'LU', 'CAFE'
  is_house            BOOLEAN DEFAULT FALSE,    -- true = Level Up's own products
  contact_person      TEXT,
  phone               TEXT,
  -- Settlement terms.
  --   'house'        = Level Up's own goods, no split
  --   'commission'   = gym keeps gym_share_percent of the sale
  --   'pass_through' = vendor keeps 100%; gym earns via fixed rent, tracked separately
  settlement_model    TEXT CHECK (settlement_model IN ('house','commission','pass_through')),
  gym_share_percent   NUMERIC(5,2) DEFAULT 0,
  settlement_cycle    TEXT CHECK (settlement_cycle IN ('daily','weekly','fortnightly','monthly')),
  notes               TEXT,
  status              TEXT DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

-- ── Catalog ──────────────────────────────────────────────────────────
CREATE TABLE pos_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  color       TEXT,           -- tile accent; helps staff scan the grid fast
  sort_order  INT DEFAULT 0,
  status      TEXT DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);

CREATE TABLE pos_products (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id         UUID REFERENCES pos_vendors(id) NOT NULL,
  category_id       UUID REFERENCES pos_categories(id),
  name              TEXT NOT NULL,
  description       TEXT,
  price             NUMERIC(10,2) NOT NULL,
  cost_price        NUMERIC(10,2),             -- optional; enables margin reporting
  member_price      NUMERIC(10,2),             -- optional member rate (see Q5)
  image_url         TEXT,                      -- Supabase Storage bucket `pos-products`
  sku               TEXT,                      -- reference only; no scanner in scope
  track_stock       BOOLEAN DEFAULT FALSE,
  stock_qty         NUMERIC(10,2) DEFAULT 0,   -- derived cache of pos_stock_movements
  low_stock_alert   NUMERIC(10,2),
  is_available      BOOLEAN DEFAULT TRUE,      -- one-tap "sold out" from the POS screen
  sort_order        INT DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);

-- Sizes/options: "Regular / Large", "1 scoop / 2 scoop". Optional per product.
CREATE TABLE pos_product_variants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   UUID REFERENCES pos_products(id) NOT NULL,
  name         TEXT NOT NULL,
  price_delta  NUMERIC(10,2) DEFAULT 0,        -- added to the base price
  sort_order   INT DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ
);

-- ── Register sessions (shift open/close, cash reconciliation) ─────────
CREATE TABLE pos_register_sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  terminal_name  TEXT,                     -- 'Cafe Counter' — ready for a 2nd terminal
  opened_by      UUID REFERENCES system_users(id) NOT NULL,
  opened_at      TIMESTAMPTZ DEFAULT NOW(),
  opening_cash   NUMERIC(10,2) DEFAULT 0,
  closed_by      UUID REFERENCES system_users(id),
  closed_at      TIMESTAMPTZ,
  counted_cash   NUMERIC(10,2),            -- what the drawer actually held
  expected_cash  NUMERIC(10,2),            -- opening + cash sales - payouts
  variance       NUMERIC(10,2),            -- counted - expected; the number that matters
  note           TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);

-- ── Orders ───────────────────────────────────────────────────────────
CREATE TABLE pos_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no        TEXT UNIQUE NOT NULL,          -- LUP-20260906-0042
  session_id      UUID REFERENCES pos_register_sessions(id),
  status          TEXT DEFAULT 'open'
                    CHECK (status IN ('open','completed','voided','refunded','partially_refunded')),
  -- Who bought
  customer_type   TEXT CHECK (customer_type IN ('walk_in','member','daily_member','staff')),
  member_id       UUID REFERENCES members(id),
  daily_member_id UUID REFERENCES daily_members(id),
  staff_id        UUID REFERENCES staff_members(id),
  customer_name   TEXT,                          -- free text for a named walk-in tab
  -- Money (all snapshots; never recomputed after completion)
  subtotal        NUMERIC(10,2) NOT NULL DEFAULT 0,
  discount_type   TEXT CHECK (discount_type IN ('none','percent','amount')),
  discount_value  NUMERIC(10,2) DEFAULT 0,
  discount_amount NUMERIC(10,2) DEFAULT 0,
  total           NUMERIC(10,2) NOT NULL DEFAULT 0,
  item_count      INT DEFAULT 0,
  -- Workflow
  served_by       UUID REFERENCES system_users(id) NOT NULL,
  completed_at    TIMESTAMPTZ,
  voided_by       UUID REFERENCES system_users(id),
  voided_at       TIMESTAMPTZ,
  void_reason     TEXT,
  refund_of_order_id     UUID REFERENCES pos_orders(id),   -- set on a refund order
  discount_authorised_by UUID REFERENCES system_users(id),
  note            TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE TABLE pos_order_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID REFERENCES pos_orders(id) NOT NULL,
  product_id          UUID REFERENCES pos_products(id),
  variant_id          UUID REFERENCES pos_product_variants(id),
  -- Snapshots at time of sale — the whole point of this table's shape.
  vendor_id           UUID REFERENCES pos_vendors(id) NOT NULL,
  product_name        TEXT NOT NULL,
  variant_name        TEXT,
  unit_price          NUMERIC(10,2) NOT NULL,
  cost_price          NUMERIC(10,2),
  qty                 NUMERIC(10,2) NOT NULL,     -- negative on a refund line
  line_discount       NUMERIC(10,2) DEFAULT 0,
  line_total          NUMERIC(10,2) NOT NULL,
  -- Settlement snapshot — frozen terms, so old reports never shift
  gym_share_percent   NUMERIC(5,2) DEFAULT 0,
  gym_share_amount    NUMERIC(10,2) DEFAULT 0,
  vendor_share_amount NUMERIC(10,2) DEFAULT 0,
  note                TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
  -- No deleted_at: order lines are immutable, like attendances / activity_logs
);

-- One row per payment method. A split payment = several rows on one order,
-- mirroring the existing fee_payments split convention.
CREATE TABLE pos_payments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID REFERENCES pos_orders(id) NOT NULL,
  method       TEXT NOT NULL CHECK (method IN
                 ('Cash','Card','EasyPaisa','JazzCash','Bank','Member Account','Complimentary')),
  amount       NUMERIC(10,2) NOT NULL,
  tendered     NUMERIC(10,2),            -- cash given, for change calculation
  change_given NUMERIC(10,2),
  reference    TEXT,                     -- wallet txn id, last 4 of card, etc.
  -- 'Member Account' only: unpaid until settled on the Fees page
  settled_at   TIMESTAMPTZ,
  settled_by   UUID REFERENCES system_users(id),
  created_at   TIMESTAMPTZ DEFAULT NOW()
  -- No deleted_at: immutable ledger. Reversals are new negative rows.
);

-- ── Stock ────────────────────────────────────────────────────────────
CREATE TABLE pos_stock_movements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID REFERENCES pos_products(id) NOT NULL,
  type        TEXT NOT NULL CHECK (type IN
                ('purchase','sale','adjustment','wastage','return','opening')),
  qty_delta   NUMERIC(10,2) NOT NULL,     -- negative on a sale
  order_id    UUID REFERENCES pos_orders(id),
  unit_cost   NUMERIC(10,2),
  reason      TEXT,
  created_by  UUID REFERENCES system_users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
  -- Immutable ledger; pos_products.stock_qty is a cache of SUM(qty_delta)
);

-- ── Vendor settlement ────────────────────────────────────────────────
CREATE TABLE pos_vendor_settlements (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id      UUID REFERENCES pos_vendors(id) NOT NULL,
  period_start   DATE NOT NULL,
  period_end     DATE NOT NULL,
  gross_sales    NUMERIC(10,2) NOT NULL,
  gym_share      NUMERIC(10,2) NOT NULL,
  vendor_share   NUMERIC(10,2) NOT NULL,
  adjustments    NUMERIC(10,2) DEFAULT 0,   -- damages, advances, corrections
  net_payable    NUMERIC(10,2) NOT NULL,
  status         TEXT DEFAULT 'draft' CHECK (status IN ('draft','finalised','paid')),
  finalised_by   UUID REFERENCES system_users(id),
  finalised_at   TIMESTAMPTZ,
  paid_at        TIMESTAMPTZ,
  payment_method TEXT,
  note           TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);
```

**Order number format:** `LUP-YYYYMMDD-NNNN`, resetting daily — consistent with the
existing `LU[M|F]-YYYY-NNNN` membership and receipt conventions. Generated server-side via
`MAX+1` within the day, **not `count(*)+1`** — commit `b891e03` fixed exactly that bug in
the device-command queue; don't reintroduce the pattern here.

**Types:** add all of the above to `src/types/database.ts`. The handoff doc notes that five
existing tables were never added there — POS should not extend that gap.

---

## 5. How the money splits

Every line carries its own vendor, so a mixed basket splits automatically:

```
Order LUP-20260906-0042                        Vendor          Gym      Vendor
  Protein Shake        x2    Rs   900   Level Up (house)    Rs 900          —
  Chicken Sandwich     x1    Rs   350   Cafe Vendor (25%)   Rs  87.50  Rs 262.50
  Fresh Juice          x1    Rs   250   Cafe Vendor (25%)   Rs  62.50  Rs 187.50
                             ────────                       ─────────  ─────────
                             Rs 1,500                       Rs 1,050   Rs 450.00
```

The customer pays Rs 1,500 once, by any mix of methods. The split is bookkeeping — it
never touches the customer experience.

At period end, **Settlements** rolls up every vendor line into a payable and the owner
marks it paid. The vendor can be shown their own ledger as a filtered read-only report.

The commission model is **confirmed** (Q1). The **25% is still a placeholder** — the actual
rate needs Khalid's sign-off before go-live, though not before the build starts: it is a
single value on `pos_vendors`, changeable without a migration.

**Member pricing interacts with the split.** When a member pays `member_price` instead of
`price`, the discount has to come out of someone's share. Two options, and this needs
deciding with the vendor:
- **Gym absorbs it** — vendor share is calculated on the full list price, and the gym's
  share shrinks (or goes negative on a deep discount). Cleaner for the vendor relationship.
- **Both absorb it** — the split percentage applies to the discounted line total, so the
  vendor shares the cost of the member benefit.

*Recommendation: gym absorbs it.* The member discount is the gym's marketing decision, not
the vendor's. Either way, `gym_share_amount` and `vendor_share_amount` are stored per line,
so whichever rule is chosen is frozen into the record and the report can always be
explained. Added as **Q1c**.

---

## 6. The POS screen — touch design spec

### 6.1 Layout (1920×1080 landscape primary; must also work at 1366×768)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [logo] LEVEL UP CAFE       Ali Raza · Cashier      14:32       [Session] │  72px
├───────────┬──────────────────────────────────────────┬───────────────────┤
│  ALL      │  ┌─────────┐ ┌─────────┐ ┌─────────┐     │  ORDER #0042      │
│ ───────── │  │ Protein │ │  Water  │ │Sandwich │     │ ───────────────── │
│  Shakes   │  │  Shake  │ │         │ │         │     │  Protein Shake    │
│           │  │ Rs 450  │ │  Rs 80  │ │ Rs 350  │     │  [−] 2 [+] Rs 900 │
│  Drinks   │  └─────────┘ └─────────┘ └─────────┘     │                   │
│           │  ┌─────────┐ ┌─────────┐ ┌─────────┐     │  Water            │
│  Snacks   │  │         │ │         │ │  SOLD   │     │  [−] 1 [+]  Rs 80 │
│           │  │         │ │         │ │   OUT   │     │                   │
│  Supps    │  └─────────┘ └─────────┘ └─────────┘     │ ───────────────── │
│           │                                          │  Subtotal  Rs 980 │
│  Merch    │                                          │  Discount    Rs 0 │
│           │                                          │  TOTAL    Rs 980  │
│           │  ┌──────────┐  ┌─ LEVEL UP ─┬─ VENDOR ─┐ │ ┌───────────────┐ │
│           │  │  Search  │  │  (active)  │          │ │ │    PAY  >     │ │
│   220px   │  └──────────┘  └────────────┴──────────┘ │ └───────────────┘ │
└───────────┴──────────────────────────────────────────┴───────────────────┘
                          flex-1                                400px
```

**Three zones, fixed forever.** Categories left, product grid centre, running order right.
The PAY button never moves. Staff stop looking at it after a week — that is the goal.

The **LEVEL UP / VENDOR** toggle filters the grid by vendor. Default is ALL, so a mixed
basket needs no switching. Each tile carries a small vendor tag so the cashier can always
tell whose product it is.

### 6.2 Sizing (derived from the research in §2)

| Element | Size | Notes |
|---------|------|-------|
| Product tile | ≥ 180 × 150 px | image/colour block, name 18px/600, price 22px Barlow Condensed 700 |
| Category rail item | full width × 72 px | 18px semibold |
| Cart line row | 72 px | qty −/+ buttons 56 × 56 |
| **PAY button** | full width × 96 px | 28px Barlow Condensed 800 |
| Keypad key | 96 × 80 px | |
| Any other control | ≥ 56 px tall | absolute floor 44px, per WCAG 2.5.5 |
| Gap between targets | 12–16 px | research minimum is 8px; we take margin |

Rationale: 44×44 is the accessibility *floor*, not a target. Kiosk guidance pushes to
12–15mm physical, and error rates roughly triple below 44px. On a fixed counter screen used
at speed by someone holding a cup, generosity is free.

### 6.3 There is no keyboard — plan every input

This is the constraint most easily forgotten. Every text or number entry needs an on-screen
equivalent:

- **Numeric keypad** (0–9, 00, backspace) for cash tendered, quantity, discount, stock counts.
- **On-screen QWERTY** for product search and customer name — or better, avoid typing:
  member lookup is a **scrollable member list with big rows**, filtered by an A–Z rail,
  rather than a search box.
- **Quick-cash buttons** on the payment sheet: `Exact`, `Rs 500`, `Rs 1000`, `Rs 5000` —
  covers the large majority of cash sales in a single tap.

### 6.4 Behaviour rules

- `touch-action: manipulation` app-wide inside the POS — removes the 300ms tap delay.
- **Pressed state on everything**: `active:scale-[0.98]` plus a colour shift, 150ms. With no
  printer chirp and no drawer clunk, on-screen feedback is the only confirmation the cashier
  gets.
- `overscroll-behavior: contain`, no text selection, no zoom — a mis-swipe must never
  pull-to-refresh a half-built order away.
- **Colour coding, consistent forever:** orange `#F06418` = primary/confirm, red = destructive
  (void, remove), grey = neutral. Never colour alone — always pair with an icon and a label.
- **Optimistic cart, confirmed payment.** Adding items is instant and local. The *sale* is
  confirmed only when the server acknowledges — spinner on the PAY button and a hard disable
  to prevent double-charging.
- **Confirm destructive actions** with a large modal. Voiding an order requires manager auth.
- Lucide icons only (already the project's icon set), never emoji.
- Keep the existing brand system: Barlow / Barlow Condensed, `#F06418`, `#1A1A1A`, `#E4E4DE`
  borders, white ground. Scale it up — do not invent a second design language.

### 6.5 Payment sheet

Full-screen overlay, not a small modal:

```
  TOTAL DUE            Rs 980
  ┌────────┐┌────────┐┌────────┐┌─────────┐
  │  CASH  ││  CARD  ││JAZZCASH││EASYPAISA│    <- 4 big method tiles
  └────────┘└────────┘└────────┘└─────────┘
  Tendered  Rs 1000         ┌──1──┬──2──┬──3──┐
  CHANGE    Rs 20           ├──4──┼──5──┼──6──┤   <- keypad, 96×80 keys
  [Exact][500][1000][5000]  ├──7──┼──8──┼──9──┤
                            └─ 00─┴──0──┴─ <- ─┘
  [  Back  ]        [  COMPLETE SALE  ]           <- 96px, orange
```

Change due renders in 48px Barlow Condensed — readable from the customer's side of the
counter. A split payment adds a second method row; the sheet tracks the remaining balance.

### 6.6 After the sale — the digital receipt

No printer, so:

1. **On-screen summary** with a **QR code** pointing at a public receipt page
   `/r/<order_no>` — the customer scans it with their own phone and keeps it.
2. That page is a small unauthenticated read-only route showing only that one order's
   contents. No member data, no other orders, no totals.
3. **Phase 3C:** WhatsApp/SMS the receipt to a member's saved number. This rides on the SMS
   module that is still a `ComingSoon` placeholder, so it cannot come earlier.
4. The screen returns to a fresh order automatically after ~8 seconds, or on one tap.

---

## 7. The admin side (owner/manager only)

| Screen | Contents |
|--------|----------|
| `/dashboard/pos/reports` | Sales by day/week/month; by vendor; by category; by product; by payment method; by cashier. Gross, gym share, vendor share, and margin where cost prices exist. |
| `/dashboard/pos/settlements` | Per-vendor payable for a period → finalise → mark paid. Vendor-facing read-only ledger. |
| `/dashboard/pos/sessions` | Every shift: opening cash, sales, expected vs counted, **variance**. Variance is the headline column. |
| `/dashboard/pos/products` | Catalog CRUD per vendor, images, availability, stock adjustments. |
| `/dashboard/pos/vendors` | Vendor records and settlement terms. |
| `/dashboard` home | One "Cafe today" tile — revenue, orders, split — owner/manager only. |
| `/dashboard/reports` | Extend the existing report with a combined **Membership + Cafe** revenue view. |

Cafe **stock purchases** should post to the existing `expenses` table under an expense head
such as `Cafe Stock`, so the P&L stays in one place. Note that `expenses` has no dashboard
UI yet — building a simple one is a small prerequisite worth folding into this phase.

Reuse `recharts` (already a dependency) and the existing `StatsCard`, `Card`, `SortableTh`
and `ViewToggle` components. `formatPKR` and `formatDate` from `src/lib/utils.ts` apply
unchanged.

---

## 8. Permissions

Proposed extension to the CLAUDE.md matrix. `system_users.role` is a CHECK constraint — per
house rules we may **add** an enum value, never remove one.

| Permission | Owner | Manager | Cashier* | Receptionist | Trainer | Viewer |
|---|---|---|---|---|---|---|
| Operate POS / take payment | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Apply discount (under threshold) | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Apply discount (over threshold) | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Void / refund an order | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Open / close register session | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| See daily totals & variance | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Manage products & prices | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| See cost price / margin | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Manage vendors & settlement terms | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Run / mark settlement paid | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |

\* `cashier` is a **new role** — **confirmed** (Q3), since the cafe is staffed separately
from reception. Reception keeps POS access too, so cover can work either way.

**Manager override:** discounts over threshold and voids prompt for a **manager PIN** on the
POS screen — no need to log the manager fully in and out mid-queue. Store PIN hashes on
`system_users` (new nullable column) and verify **server-side only**.

### What adding the `cashier` role touches

Small but easy to half-finish, so listing it explicitly:

1. **Migration** — extend the `system_users.role` CHECK constraint to include `'cashier'`.
   Per house rules this is an add, never a removal: drop and recreate the constraint with
   the full old list plus the new value.
2. **`SystemRole`** in `src/types/database.ts` — add `"cashier"`.
3. **`NAV_ROLES`** in `src/components/layout/Sidebar.tsx` — note the current default:
   `canAccess()` returns `true` for any href **not** listed in `NAV_ROLES`. A new role
   therefore gets access to unlisted routes by default, which is the wrong way round.
   Every POS admin route must be listed explicitly.
4. **Landing route** — a cashier logging in currently lands on `/dashboard`, which is not
   their screen. `dashboard/layout.tsx` should redirect `role === 'cashier'` straight to
   `/pos`, and `/pos` should be the post-login destination for them.
5. **RLS** — `current_role_in(ARRAY['owner','manager','cashier','receptionist'])` on the
   POS tables; cashiers must **not** appear in the policies for `members`, `fee_payments`
   or any other existing table beyond a read of the member list for tagging (Q4).

A cashier should be able to reach exactly two things: `/pos`, and a member lookup narrow
enough to tag a sale. Nothing else.

---

## 9. Hardware, runtime and offline

**Runtime:** Chrome in kiosk mode (`--kiosk --app=https://<domain>/pos`) on whatever PC
drives the touch monitor, plus a PWA manifest so it installs as an app. No new stack — it is
the same Next.js deployment.

**Offline.** The gym's connection will drop at some point, and the plan should be honest
about the cost of handling it:

- **Phase 3A (ship first):** online-only, but with a persistent **connection banner**, an
  optimistic cart held in local state, and retry-with-backoff on submit so a two-second blip
  never loses a sale. Catalog cached in `localStorage` so the menu always renders.
- **Phase 3C (later, if needed):** true offline-first — service worker plus an IndexedDB
  outbox and background sync, with order ids generated client-side as UUIDs and the
  sequential `order_no` assigned on sync. This is a genuine chunk of work and a real source
  of conflict bugs; recommend deferring until the gym's connection quality is known in
  practice. Whatever we build must be tested against a **flaky** connection, not a clean
  offline toggle.

---

## 10. Build phases

**Phase 3A — MVP (≈3 weeks)**
1. Migrations: vendors, categories, products, variants, orders, order_items, payments (+ RLS)
2. `cashier` role: constraint migration, `SystemRole`, `NAV_ROLES`, login redirect (§8)
3. Types in `src/types/database.ts`; API routes under `/api/pos/*` with server-side role checks
4. Admin catalog and vendor screens
5. The `/pos` touch screen: grid, cart, discounts, payment sheet, on-screen keypad
6. **Member tagging + member pricing** — big-row member picker with A–Z rail, `member_price` applied on selection
7. Digital receipt and the public `/r/<order_no>` page with QR
8. `/dashboard/pos/reports` — sales by day/vendor/product/method/member, plus the dashboard tile
9. `activity_logs` on every POS action

*A week longer than the original estimate: member tagging and member pricing moved forward
into 3A, and the `cashier` role is new work.*

**Phase 3B — Controls, tabs & settlement (≈2.5 weeks)**
10. Register sessions, shift close, Z-report, variance
11. Void / refund with manager PIN
12. **Member account tabs** — charge to account, outstanding balance on the member profile,
    and settlement on the Fees page. Ships as **one vertical**: the ability to charge a tab
    must never land before the ability to collect it, or the gym accumulates debt it has no
    screen to chase.
13. Stock movements, low-stock alerts, `expenses` UI for cafe purchases
14. Vendor settlement engine and vendor-facing ledger

**Phase 3C — Extensions (scope on demand)**
15. WhatsApp/SMS receipts (depends on the SMS module)
16. Offline-first
17. Second terminal / customer self-order screen

### Member tabs — what needs deciding before 3B

Confirmed in scope (Q6). Three guardrails are worth setting up front, because a tab system
without them is how gyms lose money quietly:

- **A tab limit per member** — a hard ceiling (say Rs 5,000) past which the POS refuses a
  charge and asks for payment. Without one, a tab has no natural stopping point.
- **Eligibility** — only `status='active'` members, and probably not members already
  delinquent on fees. The existing `isPaymentDelinquent()` in `src/lib/utils.ts` already
  computes this.
- **Visibility** — outstanding cafe balance shown on the member profile, on the Fees page
  next to their dues, and on the POS itself when the member is tagged.

Note there is no refund or credit-note system in the app today, so a mis-charged tab is
corrected the same way as any other POS error: a reversing entry, not an edit.

---

## 11. Open questions — need answers before building

**Resolved 6 Sept 2026:** Q1 (commission split), Q3 (dedicated cafe staff → `cashier` role),
Q4 (tag the member), Q5 (member pricing), Q6 (member tabs, in scope for 3B), Q9 (PRA out of
scope). See the decisions table in §1.

Still open:

**Q1b — What commission percentage?** Needs Khalid's sign-off. Not a blocker to starting —
it's one editable value on `pos_vendors`, no migration to change it — but it must be settled
before go-live.

**Q1c — Who absorbs a member discount?** When a member pays `member_price` on a vendor item,
does the vendor's share come off the list price (gym absorbs the discount) or off the
discounted total (both absorb it)? See §5. *Recommendation: gym absorbs it — the member
benefit is the gym's marketing decision, not the vendor's.* Needs agreeing with the vendor.

**Q2 — Who holds the cash?** If a customer pays cash for a vendor item into the gym's
drawer, the gym owes the vendor at settlement. Is that right, or does the vendor run their
own drawer? And how often is settlement — daily, weekly, monthly?

**Q6b — What is the member tab limit?** A hard ceiling past which the POS refuses to charge
to account. And should a member who is already delinquent on fees be blocked from opening a
tab? (`isPaymentDelinquent()` already computes that.) See §10.

**Q7 — How deep does stock tracking go?** Level Up's own products, clearly. The vendor's
too, or is their stock their own problem?

**Q8 — Which payment methods?** Cash and card assumed. JazzCash / EasyPaisa — a static QR
the customer scans, with the cashier recording the reference?

**Q10 — Hardware specifics?** Screen size and resolution, and what PC or tablet drives it.
The design assumes 1920×1080 landscape; confirming before layout work saves rework.

**Q11 — Void / discount policy.** What discount percentage can a cashier give without a
manager? How long after a sale can it be voided?

---

## 12. Risks

| Risk | Mitigation |
|------|------------|
| Vendor disputes the split | Immutable line-level snapshots plus a vendor-visible ledger; nothing is recalculated after the fact |
| Cash shrinkage | Register sessions with counted-vs-expected variance, per-cashier attribution, manager-gated voids |
| Internet drop stops sales | Cached catalog and retry queue in 3A; full offline-first in 3C |
| **PRA/FBR compliance turns out to apply** | **Accepted risk** — decided out of scope 6 Sept 2026 (Q9). No tax fields, no e-IMS integration. If the cafe is later brought under PRA, invoice numbering and a real-time API push have to be retrofitted, which means a schema change and a rework of the receipt flow. Worth a one-line confirmation from the accountant at some point, since the cost of being wrong is a rebuild rather than a patch. |
| Member tabs become uncollected debt | Hard tab limit, delinquency check at charge time, outstanding balance visible on the member profile, the Fees page and the POS itself (§10) |
| Cafe data contaminating membership reports | Separate `pos_*` tables; union only at the reporting layer |
| Role gaps repeating the existing pattern | Server-side API checks and RLS shipped with the POS migrations, not after. Note `canAccess()` defaults to *allow* for unlisted routes — the new `cashier` role must be listed explicitly everywhere (§8) |

---

*Prepared by Faisal Munir (DesignnStudio) with Claude Code. Research sources: touch target
sizing (WCAG 2.5.5, Apple HIG, Android), POS interface design principles, cafe POS feature
checklists, multi-vendor consignment settlement patterns, immutable payment-ledger design,
offline-first PWA architecture, and PRA e-IMS guidance.*
