# Phase B — Manual Smoke Test Checklist

For a human on the real touchscreen/browser. Sign in as a `cashier` or
`owner`/`manager` account (all can reach `/pos`) and work through these in
order — later steps build on earlier ones.

Use the **TEST —** prefixed products. Ignore/expect the `LU-1001`–`LU-1005`
test sales already in Recent history-adjacent data — they're there on
purpose (see `docs/phase3-test-catalogue.md`).

☐ = check off as you go. Anything that doesn't match **Expect** — stop and
tell me exactly what happened instead.

---

**1. Department & category**
☐ Tap **Supplements** in the left rail → grid filters to that department, category pills appear
☐ Tap **All Items** → grid shows every department again

**2. Add a plain product**
☐ Tap **TEST — Gatorade** → adds directly to the cart (no sheet — no modifiers/variants on the base line... unless you added the test variant, in which case a size picker should appear)
☐ Cart panel shows the line, correct price, qty 1

**3. Sold-out product**
☐ Find **TEST — Gym Shaker** (Accessories) → tile shows a **Sold out** badge, greyed out, tapping does nothing

**4. HealthBox modifiers**
☐ Tap **TEST — HealthBox Special Bowl** → full-screen Customize sheet opens
☐ **Sauce** shows 4 options, one pre-selected (Dynamic), single-select
☐ **Toppings** lets you pick up to 4, tapping a 5th does nothing (capped)
☐ **Add-ons** → tap **Extra Chicken** → price updates by +Rs 150 live

**5. Required modifier validation**
☐ Deselect the sauce (tap Dynamic again to unselect, if possible) — or open a fresh Bowl and don't touch Sauce
☐ **Add to Cart** is disabled / shows "Still needed: TEST — Sauce" until a sauce is picked

**6. Kitchen note**
☐ Tap the **Special note** field → on-screen keyboard opens with preset chips (No salt, Extra spicy, etc.)
☐ Tap a preset, or type a custom note → **Save note** → note shows back on the Customize sheet
☐ **Add to Cart** → cart line shows the note in italics

**7. Member search**
☐ Tap **Add Member** on the cart panel → picker opens
☐ Tap the search field → on-screen keyboard opens (no physical typing)
☐ Search a real member name → results appear
☐ Select a member → cart header shows their name + membership number

**8. Fixed member pricing**
☐ With a member attached, add **TEST — Gatorade** → line shows Rs 300, with Rs 350 struck through above it

**9. Percentage member discount**
☐ Add **TEST — Creatine** → line shows Rs 5,850 (10% off Rs 6,500), struck-through original above

**10. Order discount**
☐ Tap **Discount** → sheet opens, Percentage/Fixed toggle, keypad
☐ Enter **10** as a percent → live preview shows discount amount and new total
☐ **Apply Discount** → cart panel now shows a Discount line and reduced Total
☐ Reopen Discount → **Remove Discount** → total returns to full price

**11. Cash payment**
☐ Tap **PAY** → payment sheet opens with the order summary on the left
☐ Tap **Cash** → keypad and quick-cash buttons appear

**12. Quick cash buttons**
☐ Tap **Rs 1000** → Cash received shows Rs 1,000 (or adds to whatever's already typed)
☐ Tap **Exact** → Cash received jumps to exactly the total due

**13. Change due**
☐ With cash received above the total, **Change** shows the correct difference in green

**14. Split payment**
☐ Back out, tap **Split Payment** instead
☐ Add a Cash row for part of the total → shows **PAID**, Remaining drops
☐ Add a second row (Card or a wallet) for the rest → Remaining hits Rs 0
☐ **Complete Split Payment** enables only once Remaining is 0

**15. Held order**
☐ Build a basket, tap **Hold** → toast confirms a hold reference (e.g. `#H-003`), cart clears
☐ Left rail's **Held Orders** badge count increases

**16. Resume held order**
☐ Tap **Held Orders** → your held basket appears in the list with correct item count/total
☐ Tap **Resume** → basket reloads into the cart exactly as it was, `#H-00X` shows on the cart panel

**17. Completed receipt**
☐ Pay for any order → **Payment successful** screen shows the real order number (`LU-100X`), total paid, method, and change (if cash)
☐ **New Sale** → returns to an empty cart, ready for the next customer

---

## If something looks wrong

Note which step, what you tapped, and what happened vs. what this checklist
says should happen — that's enough for me to find it without you needing to
describe the code.

## When you're done

Tell me and I'll run the cleanup script in `docs/phase3-test-catalogue.md`
to remove the TEST catalogue and all `LU-1001`–`LU-1005` test sales (plus
whatever real test sales your own smoke test adds) before Phase C starts.
