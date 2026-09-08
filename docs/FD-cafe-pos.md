# Functional Document — Level Up Cafe Point of Sale

| Field | Value |
|-------|-------|
| **Document ID** | FD-LUF-POS-001 |
| **Version** | 1.0 |
| **Date** | 8 September 2026 |
| **Prepared by** | Faisal Munir — DesignnStudio |
| **Client** | Khalid Saeed (CEO), Level Up Fitness Club, Paragon City, Lahore |
| **System status** | **Not built.** Specification for build. |
| **Document type** | To-be functional specification |
| **Related documents** | `FD-LUF-GYM-001` (gym system), `docs/pos-plan.md` (approved plan) |

> **How to read this document.** This is a *to-be* FD for a system that does not yet exist.
> It specifies required behaviour. Where a decision has been made it is marked
> **[DECIDED 6 Sep]**; where one is still outstanding it is marked **[OPEN]** and carries a
> question reference. No open item blocks the start of the build.

---

## 1. Purpose and scope

### 1.1 Purpose

A touchscreen point-of-sale system for the cafe operating inside Level Up Fitness Club. It
must sell two catalogues side by side — the gym's own products and a third-party vendor's —
split the revenue correctly per item, and surface all cafe finances inside the existing gym
dashboard for administrators only.

### 1.2 In scope

Product catalogue with two vendors; touchscreen order entry; member tagging and member
pricing; discounts; multi-method payment; digital receipts; void and refund; cash-drawer
reconciliation by shift; member account tabs; stock movements; vendor settlement; and
administrative reporting.

### 1.3 Out of scope

| Item | Reason |
|------|--------|
| Barcode scanning | No scanner in the deployment |
| Receipt printing | No printer in the deployment; receipts are digital |
| **PRA / FBR tax invoicing** | **[DECIDED 6 Sep]** Ruled out of scope — see risk R-04 |
| Kitchen display system | Not required |
| Online / delivery ordering | Not required |
| Table management | Counter service only |

### 1.4 Business context

| Seller | Sells | Revenue treatment |
|--------|-------|-------------------|
| **Level Up (house)** | Supplements, protein shakes, water, merchandise | 100% gym revenue |
| **The vendor** | Cafe food and drinks | **Commission split** — gym retains a percentage **[DECIDED 6 Sep]** |

A single customer may buy from both in one order. **Handling that mixed basket and
splitting it at line level is the defining requirement of this system** and drives the data
model in §5.

---

## 2. Actors and roles

| Actor | Description |
|-------|-------------|
| **Cashier** | **New role [DECIDED 6 Sep].** Dedicated cafe staff. Operates the terminal, opens and closes a shift. Cannot see totals, margins or cost prices, and cannot void. |
| **Receptionist** | Retains POS access so reception can cover the counter. Same operational limits as Cashier. |
| **Manager** | Everything operational, plus voids, refunds, over-threshold discounts, reports and settlement. |
| **Owner** | Everything, plus vendor records and commercial terms. |
| **Vendor** | Not a system user. Receives a read-only settlement ledger produced by the system. |
| **Customer** | Not a system user. Scans a QR code to retrieve their receipt. |

---

## 3. System context

The POS is **part of the existing Next.js application and the existing Supabase database** —
no new stack, no new deployment. It adds new routes and new tables.

| Surface | Route | Layout |
|---------|-------|--------|
| Terminal | `/pos` | **Own full-screen layout**, outside the dashboard shell |
| Public receipt | `/r/<order_no>` | Minimal, unauthenticated |
| Administration | `/dashboard/pos/*` | Existing dashboard shell |
| API | `/api/pos/*` | Server routes with role checks |

**FR-POS-ARCH-01.** The terminal must not use `src/app/dashboard/layout.tsx`. That layout
carries a 240px sidebar of small links, which on a touch monitor is wasted space and a route
out of a half-finished sale.

**FR-POS-ARCH-02.** Cafe sales must **not** be written to `fee_payments`. That table's
split-payment convention (BR-FEE-01 in FD-LUF-GYM-001) is load-bearing for every membership
report and trainer-commission calculation. Cafe sales use dedicated `pos_*` tables, combined
with membership revenue only at the **reporting** layer.

**FR-POS-ARCH-03.** All order writes go through `/api/pos/*` routes that re-verify the
caller's role server-side. Client-side guards alone are not acceptable for a cash-handling
module.

**FR-POS-ARCH-04.** RLS policies ship **with** the POS migrations, using the existing
`current_role_in(ARRAY[...])` helper. The POS must not inherit the gym system's
nav-visibility-only pattern (gap G-03).

---

## 4. Functional modules

### FR-POS-CAT — Catalogue management

Administrative screens at `/dashboard/pos/vendors` and `/dashboard/pos/products`.

| ID | Requirement |
|----|-------------|
| FR-POS-CAT-01 | The system holds a vendor register. It is seeded with two records: **Level Up** (`is_house = true`) and the cafe vendor. |
| FR-POS-CAT-02 | A vendor carries a settlement model — `house`, `commission` or `pass_through` — a `gym_share_percent`, and a settlement cycle. |
| FR-POS-CAT-03 | Vendor records and commercial terms are editable by **Owner only**. |
| FR-POS-CAT-04 | Categories carry a name, an accent colour and a sort order. Colour exists so staff can scan the grid quickly. |
| FR-POS-CAT-05 | Every product belongs to **exactly one** vendor and one category. |
| FR-POS-CAT-06 | A product carries name, description, price, optional cost price, optional member price, image, sort order and availability. |
| FR-POS-CAT-07 | A product may carry variants (e.g. Regular / Large, 1 scoop / 2 scoop), each with a price delta against the base price. |
| FR-POS-CAT-08 | Product images upload to a Supabase Storage bucket `pos-products`. |
| FR-POS-CAT-09 | A product may be marked **sold out** in one tap from the terminal itself, without opening the admin screen. |
| FR-POS-CAT-10 | Cost price and margin are visible to Owner and Manager only, and must be filtered **server-side**, not merely hidden in the interface. |

---

### FR-POS-SES — Register session

| ID | Requirement |
|----|-------------|
| FR-POS-SES-01 | No sale may be recorded outside an open register session. The terminal prompts to open one on first use of a shift. |
| FR-POS-SES-02 | Opening a session records the operator, the timestamp and the **opening cash float**. |
| FR-POS-SES-03 | Closing a session prompts for the **counted cash** in the drawer. |
| FR-POS-SES-04 | The system computes `expected_cash` = opening float + cash sales − payouts, and stores `variance` = counted − expected. |
| FR-POS-SES-05 | The close screen shows the variance immediately, and requires a note when it is non-zero. |
| FR-POS-SES-06 | A session shift report (Z-report) is viewable at `/dashboard/pos/sessions` by Owner and Manager. Cashiers cannot see it. |
| FR-POS-SES-07 | The data model supports multiple named terminals from the outset, even though one is deployed. |

**Business rule BR-POS-SES-01.** Variance is the primary cash control in the system. It is
the headline column of the sessions report, not a footnote.

---

### FR-POS-ORD — Order entry

The terminal at `/pos`. Layout is specified in §7.

| ID | Requirement |
|----|-------------|
| FR-POS-ORD-01 | Products display as a tappable grid. Selecting a product adds one unit to the running order. |
| FR-POS-ORD-02 | The grid filters by category (left rail) and by vendor (Level Up / Vendor toggle). The default is **all vendors**, so a mixed basket needs no switching. |
| FR-POS-ORD-03 | Every product tile carries a vendor tag, so the cashier can always tell whose product it is. |
| FR-POS-ORD-04 | A product with variants opens a variant chooser before it is added. |
| FR-POS-ORD-05 | The order panel shows each line with name, quantity, and line total, with **−** and **+** steppers. |
| FR-POS-ORD-06 | Removing a line requires a single tap plus confirmation. |
| FR-POS-ORD-07 | Adding to the order is **optimistic and local** — no network round trip per tap. |
| FR-POS-ORD-08 | A discount may be applied to the whole order as a percentage or a flat amount. |
| FR-POS-ORD-09 | A discount above the configured threshold requires a **manager PIN**, verified server-side. |
| FR-POS-ORD-10 | The order panel shows subtotal, discount and total at all times. |
| FR-POS-ORD-11 | An order may be **held** and recalled, so a second customer can be served while the first decides. |
| FR-POS-ORD-12 | Order numbers follow `LUP-YYYYMMDD-NNNN`, resetting daily, generated server-side using **`MAX+1`, never `count(*)+1`**. |

---

### FR-POS-MEM — Member tagging and pricing

**[DECIDED 6 Sep]** — both in scope for the first release.

| ID | Requirement |
|----|-------------|
| FR-POS-MEM-01 | A sale may be tagged to a gym member, giving per-member purchase history. |
| FR-POS-MEM-02 | Member lookup is a **scrollable list of large rows with an A–Z filter rail**, not a text search box. There is no keyboard at the terminal. |
| FR-POS-MEM-03 | Tagging a member applies `member_price` to every line that has one, recalculating the order immediately. |
| FR-POS-MEM-04 | Untagging the member reverts all lines to list price. |
| FR-POS-MEM-05 | The member's name and membership number display on the order panel while tagged. |
| FR-POS-MEM-06 | A sale may also be tagged to a daily member or a staff member. |
| FR-POS-MEM-07 | The member list read available to a cashier must expose name, membership number and status **only** — no contact details, no financial history. |

**Business rule BR-POS-MEM-01 [OPEN — Q1c].** When a member discount applies to a *vendor*
item, the discount must be attributed to one party. Two options: the **gym absorbs it**
(vendor share calculated on full list price) or **both absorb it** (split applied to the
discounted line total). *Recommendation: the gym absorbs it — the member benefit is the
gym's marketing decision, not the vendor's.* Whichever is chosen, both share amounts are
stored per line, so the record is unambiguous after the fact.

---

### FR-POS-PAY — Payment

| ID | Requirement |
|----|-------------|
| FR-POS-PAY-01 | Payment opens as a **full-screen overlay**, not a small modal. |
| FR-POS-PAY-02 | Supported methods: Cash, Card, EasyPaisa, JazzCash, Bank, Member Account, Complimentary. **[OPEN — Q8]** confirms the final list. |
| FR-POS-PAY-03 | Cash entry uses an **on-screen numeric keypad** plus quick-cash buttons: Exact, Rs 500, Rs 1000, Rs 5000. |
| FR-POS-PAY-04 | Change due is computed live and displayed at 48px, legible from the customer's side of the counter. |
| FR-POS-PAY-05 | An order may be **split across multiple methods**; the sheet tracks the remaining balance until it reaches zero. |
| FR-POS-PAY-06 | Each method used produces one `pos_payments` row against the order. |
| FR-POS-PAY-07 | Wallet and card payments may record a reference (transaction id, last four digits). |
| FR-POS-PAY-08 | The Complete Sale action is **disabled while the request is in flight**, and shows a spinner. The order must not be submittable twice. |
| FR-POS-PAY-09 | On server acknowledgement the order status becomes `completed` and `completed_at` is stamped. |
| FR-POS-PAY-10 | If the server does not acknowledge, the terminal retries with backoff and shows a clear failure state. It must never silently discard a sale. |

---

### FR-POS-TAB — Member account tabs

**[DECIDED 6 Sep]** — in scope. Delivered in Phase 3B.

| ID | Requirement |
|----|-------------|
| FR-POS-TAB-01 | A tagged member may pay by **Member Account**, creating an unsettled `pos_payments` row. |
| FR-POS-TAB-02 | The member's outstanding cafe balance is shown on the member profile, on the Fees page beside their dues, and on the POS the moment they are tagged. |
| FR-POS-TAB-03 | The tab is settled from the Fees page; settlement stamps `settled_at` and `settled_by`. |
| FR-POS-TAB-04 | A **hard tab limit** applies. Past it, the POS refuses the charge and asks for another method. **[OPEN — Q6b]** sets the figure. |
| FR-POS-TAB-05 | Only members with `status='active'` may charge to account. |
| FR-POS-TAB-06 | A member already delinquent on fees is blocked from opening a tab, reusing `isPaymentDelinquent()` from the gym system. **[OPEN — Q6b]** confirms. |

**Business rule BR-POS-TAB-01.** The ability to charge a tab and the ability to collect one
**ship together**. A release that can create a receivable without a screen to chase it is
not acceptable.

**Business rule BR-POS-TAB-02.** There is no credit-note or refund mechanism. A
mis-charged tab is corrected by a reversing entry, exactly as any other POS error.

---

### FR-POS-RCP — Digital receipt

No printer is deployed.

| ID | Requirement |
|----|-------------|
| FR-POS-RCP-01 | On completion the terminal shows an order summary with a **QR code**. |
| FR-POS-RCP-02 | The QR encodes `/r/<order_no>`, a public unauthenticated read-only page the customer opens on their own phone. |
| FR-POS-RCP-03 | That page shows **only that one order** — items, quantities, prices, discount, total, payment method, date and outlet. It must expose no member data, no other orders and no aggregate figures. |
| FR-POS-RCP-04 | The terminal returns to a fresh order automatically after approximately 8 seconds, or on one tap. |
| FR-POS-RCP-05 | *Future:* the receipt may be sent by WhatsApp or SMS to a tagged member's saved number. This depends on the SMS module, which is not built (FR-SMS in FD-LUF-GYM-001). |

---

### FR-POS-VOI — Void and refund

| ID | Requirement |
|----|-------------|
| FR-POS-VOI-01 | A completed order's lines and totals are **immutable**. |
| FR-POS-VOI-02 | **Void** sets `status='voided'`, retains every row, and records the authorising user, timestamp and a mandatory reason. |
| FR-POS-VOI-03 | Void requires a **manager PIN**, verified server-side. A cashier cannot void. |
| FR-POS-VOI-04 | Void is available only within the configured window and only before the order's period has been settled. **[OPEN — Q11]** sets the window. |
| FR-POS-VOI-05 | **Refund** creates a new order linked by `refund_of_order_id`, carrying negative quantities, so the ledger nets out and the original history is preserved. |
| FR-POS-VOI-06 | A void or refund reverses the corresponding stock movements. |
| FR-POS-VOI-07 | Every void and refund writes an `activity_logs` row. |

---

### FR-POS-STK — Stock

| ID | Requirement |
|----|-------------|
| FR-POS-STK-01 | Stock tracking is **optional per product** via a `track_stock` flag. |
| FR-POS-STK-02 | All stock changes are recorded as immutable movements typed `purchase`, `sale`, `adjustment`, `wastage`, `return` or `opening`. |
| FR-POS-STK-03 | `pos_products.stock_qty` is a **derived cache** of the movement ledger, never the source of truth. |
| FR-POS-STK-04 | Completing a sale writes negative movements for every tracked line. |
| FR-POS-STK-05 | A product at or below its low-stock threshold is flagged on the admin screen. |
| FR-POS-STK-06 | Cafe stock purchases post to the existing `expenses` table under an expense head such as `Cafe Stock`, so the P&L stays in one place. |
| FR-POS-STK-07 | **[OPEN — Q7]** Whether the vendor's stock is tracked, or only Level Up's own. |

> **Dependency.** `expenses` has no dashboard screen today (gap in FD-LUF-GYM-001 §11).
> A minimal expenses UI is a prerequisite for FR-POS-STK-06.

---

### FR-POS-SET — Vendor settlement

| ID | Requirement |
|----|-------------|
| FR-POS-SET-01 | Each order line stores `vendor_id`, `gym_share_percent`, `gym_share_amount` and `vendor_share_amount` **as snapshots at time of sale**. |
| FR-POS-SET-02 | A settlement is generated for a vendor over a date range, aggregating gross sales, gym share and vendor share from those snapshots. |
| FR-POS-SET-03 | A settlement supports manual adjustments — damages, advances, corrections — producing a net payable. |
| FR-POS-SET-04 | A settlement moves `draft` → `finalised` → `paid`, recording who finalised it and when it was paid. |
| FR-POS-SET-05 | A finalised settlement is not recalculated if catalogue prices or vendor terms change afterwards. |
| FR-POS-SET-06 | The vendor receives a **read-only ledger** of their own lines for the period. |
| FR-POS-SET-07 | Voided orders are excluded; refunds are included as negatives. |

**Business rule BR-POS-SET-01 — snapshot, never recompute.** Prices change, products are
renamed, and a product can move between vendors. A settlement report re-run in December for
August must reproduce August exactly. This is why §5's line table stores copies rather than
relying on joins. It is also the system's answer to a vendor dispute.

**Business rule BR-POS-SET-02.** The commission model is confirmed; **the percentage is
not** — **[OPEN — Q1b]**. It is a single editable value on the vendor record, changeable
without a migration, but it must be correct before the first real settlement runs.

**[OPEN — Q2]** Who physically holds the cash. If a customer pays cash for a vendor item
into the gym's drawer, the gym owes the vendor at settlement. This must be confirmed, along
with the settlement frequency.

---

### FR-POS-RPT — Reporting

All reporting is **Owner and Manager only**.

| ID | Requirement |
|----|-------------|
| FR-POS-RPT-01 | `/dashboard/pos/reports` reports sales by day, week and month. |
| FR-POS-RPT-02 | Breakdowns by vendor, category, product, payment method, cashier and member. |
| FR-POS-RPT-03 | Each shows gross, gym share, vendor share, and margin where cost prices exist. |
| FR-POS-RPT-04 | The dashboard home carries a single "Cafe today" tile — revenue, order count, vendor split. |
| FR-POS-RPT-05 | The existing `/dashboard/reports` gains a **combined Membership + Cafe** revenue view, unioned at the reporting layer only. |
| FR-POS-RPT-06 | Cafe revenue reporting is **cash-basis**, consistent with BR-FEE-03 in the gym system. |
| FR-POS-RPT-07 | Reporting reuses the existing `recharts`, `StatsCard`, `Card`, `SortableTh` and `ViewToggle` components, and `formatPKR` / `formatDate`. |

---

## 5. Data model

Ten new tables. All follow the gym system's schema rules (BR-DATA-01…06 in FD-LUF-GYM-001):
soft delete via `deleted_at`, additive-only columns, one timestamped migration file each.

| Table | Purpose | Soft delete |
|-------|---------|-------------|
| `pos_vendors` | Level Up and the cafe vendor, with settlement terms | Yes |
| `pos_categories` | Grid groupings | Yes |
| `pos_products` | The catalogue, one vendor per product | Yes |
| `pos_product_variants` | Sizes and options with a price delta | Yes |
| `pos_register_sessions` | Shift open/close and cash variance | Yes |
| `pos_orders` | Sale header, totals frozen at completion | Yes |
| `pos_order_items` | Sale lines with vendor and share snapshots | **No — immutable** |
| `pos_payments` | One row per payment method | **No — immutable** |
| `pos_stock_movements` | Stock ledger | **No — immutable** |
| `pos_vendor_settlements` | Period payable per vendor | Yes |

Full DDL is in `docs/pos-plan.md` §4.

### 5.1 Key structural requirements

| ID | Requirement |
|----|-------------|
| FR-POS-DATA-01 | `pos_order_items` stores `product_name`, `variant_name`, `unit_price`, `cost_price`, `vendor_id` and `gym_share_percent` as **snapshots**, not merely foreign keys. |
| FR-POS-DATA-02 | A split payment produces several `pos_payments` rows against one order, mirroring the gym system's existing convention. |
| FR-POS-DATA-03 | All ten tables are added to `src/types/database.ts`. The POS must not extend the existing type-coverage gap (G-09). |
| FR-POS-DATA-04 | Every POS action writes an `activity_logs` row. |
| FR-POS-DATA-05 | Aggregate queries use `fetchAllRows<T>()` — Supabase silently truncates at 1,000 rows. |

---

## 6. Permissions

### 6.1 Matrix

| Permission | Owner | Manager | Cashier | Receptionist | Trainer | Viewer |
|-----------|:-----:|:-------:|:-------:|:------------:|:-------:|:------:|
| Operate POS / take payment | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Discount, under threshold | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Discount, over threshold | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Void / refund an order | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Open / close register session | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| See daily totals and variance | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Manage products and prices | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| See cost price / margin | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Manage vendors and terms | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Run / mark settlement paid | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Charge to member account | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Settle a member tab | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ |

### 6.2 Adding the `cashier` role — implementation checklist

**[DECIDED 6 Sep]** The cafe is staffed separately from reception, so a new role is
required. This is small but easy to half-finish.

| ID | Requirement |
|----|-------------|
| FR-POS-ROLE-01 | Migration extends the `system_users.role` CHECK constraint to include `'cashier'`. Per BR-DATA-04 this is an add: recreate the constraint with the full existing list plus the new value. |
| FR-POS-ROLE-02 | `SystemRole` in `src/types/database.ts` gains `"cashier"`. |
| FR-POS-ROLE-03 | Every POS route is listed explicitly in `NAV_ROLES`. **`canAccess()` returns `true` for any route not listed** (gap G-06), so omission grants access rather than denying it. |
| FR-POS-ROLE-04 | `dashboard/layout.tsx` redirects `role === 'cashier'` to `/pos`. A cashier must not land on the gym dashboard. |
| FR-POS-ROLE-05 | RLS policies grant cashiers access to POS tables only, plus the narrow member read defined in FR-POS-MEM-07. |
| FR-POS-ROLE-06 | Manager PIN hashes are stored in a new nullable column on `system_users` and verified **server-side only**. |

**Business rule BR-POS-ROLE-01.** A cashier can reach exactly two things: `/pos`, and a
member lookup wide enough to tag a sale. Nothing else.

---

## 7. Non-functional requirements — the touchscreen

The terminal is a fixed touch monitor. **There is no mouse, no barcode scanner, no printer
and no keyboard.**

### 7.1 Layout

Three fixed zones: category rail left (220px), product grid centre (flexible), order panel
right (400px). Designed for 1920×1080 landscape, usable at 1366×768. **[OPEN — Q10]**
confirms the hardware.

**NFR-POS-01.** The three zones and the PAY button never move between releases. Staff build
muscle memory; relocating a control costs money in mis-taps.

### 7.2 Target sizing

| Element | Minimum size |
|---------|--------------|
| Product tile | 180 × 150 px |
| Category rail item | full width × 72 px |
| Order line row | 72 px, with 56 × 56 quantity steppers |
| **PAY button** | full width × 96 px |
| Numeric keypad key | 96 × 80 px |
| Any other control | 56 px tall |
| **Absolute floor** | **44 × 44 px** |
| Gap between adjacent targets | 12–16 px |

**NFR-POS-02.** 44 × 44 px is the accessibility floor set by WCAG 2.5.5, matching Apple's
44pt and Android's 48dp guidance. Fixed kiosks are advised toward 12–15 mm physical, and
targets below 44 px show roughly three times the tap error rate. The sizes above are
deliberately generous because the operator is working at speed, often one-handed.

**NFR-POS-03.** The three-tap rule: any function is reachable in three taps or fewer. A
common item is two — tap the item, tap PAY.

### 7.3 Input without a keyboard

**NFR-POS-04.** Every numeric entry — cash tendered, quantity, discount, stock count — is
served by an on-screen numeric keypad. Every textual entry either has an on-screen keyboard
or is redesigned to avoid typing (see FR-POS-MEM-02).

### 7.4 Behaviour

| ID | Requirement |
|----|-------------|
| NFR-POS-05 | `touch-action: manipulation` across the terminal, removing the 300 ms tap delay. |
| NFR-POS-06 | Every control has a visible pressed state — a 150 ms scale and colour shift. With no printer chirp and no drawer clunk, this is the operator's only confirmation. |
| NFR-POS-07 | No hover-dependent affordances. Touch has no hover; everything is visible at rest. |
| NFR-POS-08 | `overscroll-behavior: contain`, text selection disabled, zoom locked — a mis-swipe must never discard a half-built order. |
| NFR-POS-09 | Colour semantics are fixed: orange `#F06418` confirms, red destroys, grey is neutral. Colour is never the sole indicator — always with an icon and a label. |
| NFR-POS-10 | Destructive actions confirm through a large modal, never a small one. |
| NFR-POS-11 | Lucide icons only, matching the gym system. Never emoji. |
| NFR-POS-12 | The existing brand system applies, scaled up: Barlow / Barlow Condensed, `#F06418`, `#1A1A1A`, `#E4E4DE`. No second design language. |

### 7.5 Runtime and resilience

| ID | Requirement |
|----|-------------|
| NFR-POS-13 | The terminal runs Chrome in kiosk mode — `--kiosk --app=https://<domain>/pos` — with a PWA manifest so it installs as an application. |
| NFR-POS-14 | The product catalogue caches to `localStorage` so the menu always renders, connection or not. |
| NFR-POS-15 | A persistent connection banner shows when the terminal is offline. |
| NFR-POS-16 | Order submission retries with backoff. A brief connection blip must never lose a sale. |
| NFR-POS-17 | *Future:* full offline-first with a service worker, an IndexedDB outbox and background sync, with client-generated UUIDs and `order_no` assigned on sync. Deferred until the gym's real connection quality is known. |
| NFR-POS-18 | Any offline work must be tested against a **flaky** connection, not a clean on/off toggle. Intermittent is what actually happens. |

---

## 8. Delivery phases

| Phase | Scope | Estimate |
|-------|-------|----------|
| **3A — MVP** | Migrations and RLS; `cashier` role; API routes; catalogue and vendor admin; the terminal with grid, order panel, discounts, payment sheet and keypad; member tagging and member pricing; digital receipt and public receipt page; sales reporting and the dashboard tile; activity logging | ≈ 3 weeks |
| **3B — Controls, tabs and settlement** | Register sessions and variance; void and refund with manager PIN; member account tabs with their collection path; stock movements and the expenses UI; vendor settlement engine and vendor ledger | ≈ 2.5 weeks |
| **3C — Extensions** | WhatsApp/SMS receipts; offline-first; a second terminal or customer self-order screen | On demand |

---

## 9. Open items

None of these block the start of Phase 3A.

| Ref | Question | Needed by | Owner |
|-----|----------|-----------|-------|
| **Q1b** | What commission percentage? | Before first settlement | Khalid |
| **Q1c** | Who absorbs a member discount on a vendor item? | Before 3A member pricing | Khalid + vendor |
| **Q2** | Who holds the cash, and how often is settlement? | Before 3B | Khalid |
| **Q6b** | Member tab limit, and whether delinquent members may open one | Before 3B | Khalid |
| **Q7** | Is the vendor's stock tracked? | Before 3B | Khalid + vendor |
| **Q8** | Final list of payment methods; how wallet payments are captured | Before 3A payment sheet | Khalid |
| **Q10** | Screen size, resolution, and the machine driving it | Before terminal layout work | Faisal |
| **Q11** | Cashier discount ceiling; void window | Before 3B | Khalid |

---

## 10. Risks

| # | Risk | Mitigation |
|---|------|------------|
| R-01 | Vendor disputes the split | Immutable line-level snapshots plus a vendor-visible ledger. Nothing is recalculated after the fact. |
| R-02 | Cash shrinkage | Register sessions with counted-vs-expected variance, per-cashier attribution, manager-gated voids and discounts. |
| R-03 | Connection loss stops sales | Cached catalogue and retry queue in 3A; full offline-first available in 3C. |
| R-04 | **PRA compliance turns out to apply** | **Accepted risk.** Ruled out of scope 6 Sep 2026. Cafes in Punjab are required to integrate POS with the Punjab Revenue Authority's e-IMS under the Punjab Sales Tax on Services Act 2012. If the cafe is later brought into scope, invoice numbering and a real-time API push must be retrofitted — a schema change plus a rework of the receipt flow. A one-line confirmation from the accountant would close this cheaply. |
| R-05 | Member tabs become uncollected debt | Hard tab limit, delinquency check at charge time, balance surfaced in three places, and charge/collect shipped together. |
| R-06 | Cafe data contaminating membership reports | Separate `pos_*` tables; union only at the reporting layer. |
| R-07 | Repeating the gym system's role gaps | Server-side API checks and RLS ship with the POS migrations. Note `canAccess()` fails open — every POS route must be listed. |

---

## 11. Assumptions

| ID | Assumption |
|----|------------|
| A-01 | One terminal at one counter. The data model supports more; the deployment does not. |
| A-02 | Counter service only — no table numbers, no course timing, no kitchen routing. |
| A-03 | The cafe operates during gym hours; the register session maps to a staff shift, not a calendar day. |
| A-04 | The vendor is a single commercial party. Additional vendors are supported by the data model without a migration. |
| A-05 | Customers have smartphones capable of scanning a QR code. Anyone who does not simply leaves without a receipt. |
| A-06 | Migrations are applied manually, as in the gym system. |

---

## Revision history

| Version | Date | Author | Change |
|---------|------|--------|--------|
| 1.0 | 8 Sept 2026 | Faisal Munir | Initial functional specification, incorporating the decisions of 6 September |
