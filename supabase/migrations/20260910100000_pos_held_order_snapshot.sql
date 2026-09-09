-- Phase 3B — persistence for held (parked) orders.
--
-- NO RLS IN THIS FILE (see 20260909100000 header — still deferred to its
-- own reviewed change set).
--
-- WHY THIS EXISTS.
--
-- pos_order_items was deliberately built as an immutable ledger: no
-- deleted_at, no UPDATE policy proposed in the RLS change set, written
-- once at the moment of sale (see 20260909100300's header comment). That
-- invariant is what lets a settlement report re-run months later reproduce
-- history exactly.
--
-- A held order is the opposite of that: a cashier parks a half-built
-- basket, walks away, comes back, adds an item, removes another, then
-- either completes it or abandons it. That is draft state, not ledger
-- state, and writing it into pos_order_items would force a choice between
-- hard-deleting "immutable" rows (undermining the invariant everywhere
-- else) or leaving orphaned draft rows behind every time a basket changes
-- before checkout.
--
-- So held baskets are stored here instead, as a snapshot, and
-- pos_order_items continues to be written exactly once — only at the
-- moment an order actually completes. This column is cleared (set back to
-- NULL) at that point; the completed order's real, immutable lines are
-- what pos_order_items holds from then on.
ALTER TABLE public.pos_orders
  ADD COLUMN IF NOT EXISTS cart_snapshot JSONB;

COMMENT ON COLUMN public.pos_orders.cart_snapshot IS
  'Draft basket while status=held. Cleared to NULL at completion, when real pos_order_items rows are written. Never read once an order is completed.';
