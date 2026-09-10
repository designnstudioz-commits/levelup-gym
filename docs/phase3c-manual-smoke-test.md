# Phase C — Manual Smoke Test Checklist

Covers register sessions, void/refund with manager approval, shift
reconciliation, exceptions, and the configurable over-limit discount gate.
The dev server should already be running (`npm run dev`); sign in as an
`owner` or `manager` for the setup steps, and as `cashier` (or reception)
for the terminal steps.

## 0. One-time setup

☐ As owner/manager, go to **Dashboard → POS & Inventory → Cash Sessions**
☐ In the **"Your manager override PIN"** card at the top, set a 4–6 digit PIN and **Save PIN**
☐ Add at least one real sellable product if you haven't already (Phase D's catalogue admin isn't built yet — use whatever exists, or ask me to seed a small `TEST —` set again like Phase B's, if you'd rather not use real products)

Without step 0, void/refund cannot be tested — there is no manager PIN to authorise them yet.

---

## 1. Register session — open, sell, close

☐ Sign in as a cashier (or reception) → `/pos` shows an **Open Your Shift** screen instead of the terminal
☐ Enter an opening cash amount → **Start Shift** → the terminal appears, top bar shows **Shift open**
☐ Left rail shows a **Current shift** figure (starts at Rs 0 / 0 orders)
☐ Complete one cash sale → the rail's current-shift figure updates
☐ Tap **Close Shift** in the top bar → enter a counted cash amount that matches what you'd expect → **Close Shift**
☐ Expected Cash / Counted Cash / Variance show correctly, variance is Rs 0 if you counted right
☐ **Sign Out** returns to login

## 2. Shift reconciliation (admin)

☐ As owner/manager, go to **Cash Sessions** → the shift you just closed appears in the table with correct Expected/Counted/Variance
☐ Click **Review & Lock** on that shift → it moves to status **Reviewed**
☐ The **Payment Mix** panel below the table shows the correct breakdown when that shift is selected

## 3. Void, with a manager physically present

☐ At the terminal, complete a sale
☐ Open **Held Orders / Recent Orders** (rail → Recent Sales) → your sale appears
☐ Tap **Void** → pick a reason → **Manager is here now** → enter the PIN you set in step 0
☐ Confirms instantly; the order shows **Voided** in Recent Orders
☐ In admin **POS Orders**, that order shows status **Voided**

## 4. Refund, with a manager physically present

☐ Complete another sale
☐ From Recent Orders, tap **Refund** → pick a reason → choose a payout method (e.g. Cash) → **Manager is here now** → PIN
☐ Confirms instantly; a new order appears with the refund (negative amount, shown in red)
☐ Original order shows status **Refunded** in admin **POS Orders**

## 5. Void/refund without a manager present (async)

☐ Complete a sale, open Recent Orders, tap **Void** (or Refund) → pick a reason → **Request approval for later**
☐ Order shows a **Void pending** (or **Refund pending**) badge in Recent Orders
☐ As owner/manager, go to **Cash Sessions → Exceptions & Approvals** → the pending request appears
☐ Click **Approve** → the void/refund posts, same as the instant path
☐ Try again with a fresh sale, this time click **Reject** → the order is untouched, request shows resolved

## 6. Over-limit discount approval

☐ **This needs a real limit configured first** — there is none by default, so ask me to set `pos_settings.cashier_discount_limit_percent` to a real number (e.g. 15) before this step
☐ Signed in as **cashier**, open Discount → enter a percentage **above** the configured limit → **Apply Discount**
☐ Instead of applying immediately, a manager PIN prompt appears
☐ Enter the wrong PIN → clear error, stays on the prompt
☐ Enter the correct PIN → discount applies, toast shows who approved it
☐ Try a discount **under** the limit → applies immediately, no PIN asked
☐ Signed in as **owner/manager** directly, apply any discount, any size → never prompted for a PIN (you are the approver)

## 7. Void window

☐ (Optional — needs time to pass, or ask me to temporarily lower `pos_settings.void_window_minutes`) — after the configured window, **Void** on an old order should fail with a clear message suggesting Refund instead; Refund should still work regardless of age

---

## If something looks wrong

Note the step, what you tapped, and what happened instead — enough for me
to trace it without you describing the code.

## When you're done

Tell me and I'll help clean up anything the test added (test sales,
sessions) the same way we did after Phase B.
