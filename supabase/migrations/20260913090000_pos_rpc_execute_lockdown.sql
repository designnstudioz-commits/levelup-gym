-- Phase H — CRITICAL FIX: lock down EXECUTE on every POS SECURITY DEFINER
-- RPC function to service_role only.
--
-- Supabase grants EXECUTE on every new Postgres function to `anon` and
-- `authenticated` by default (so PostgREST/supabase-js can call it), unless
-- explicitly revoked. Phase 3B/3C's functions (pos_complete_order,
-- pos_void_order, pos_refund_order) already had this revoked — but
-- pos_receive_stock, pos_adjust_stock, pos_apply_stock_count (Phase E) and
-- pos_finalize_healthbox_settlement, pos_mark_settlement_paid (Phase G)
-- did NOT, and were discovered wide open during the Phase H audit:
--
--   SELECT has_function_privilege('anon', 'pos_finalize_healthbox_settlement(jsonb)', 'EXECUTE');
--   -- returned true
--
-- Every one of these functions is SECURITY DEFINER and trusts its `payload`
-- JSONB blindly, including `caller_id` — they were written assuming the
-- only caller is the Next.js server (via the service-role client, AFTER
-- requirePosUser() has already verified the real session and role). With
-- EXECUTE open to `anon`, anyone with only the public anon key (embedded in
-- the client bundle — no login required) could call
-- `supabase.rpc('pos_finalize_healthbox_settlement', {...})` directly from
-- a browser console, pass a fabricated caller_id claiming to be an owner,
-- and finalize/forge a real settlement.
--
-- This migration revokes EXECUTE from PUBLIC (which implicitly covers
-- anon/authenticated unless separately granted — both are also revoked
-- explicitly to remove any direct grant) and grants it only to
-- service_role, for every POS RPC function that exists today. The three
-- already-correct functions are included too, so this migration is a
-- complete, self-documenting statement of the intended grant model rather
-- than relying on tribal knowledge of which ones were already safe.
--
-- Nothing in the app breaks: every call site uses
-- createServiceClient(..., SUPABASE_SERVICE_ROLE_KEY) — the service_role
-- key — which already had (and keeps) EXECUTE regardless of this change.
--
-- Rollback: re-run the GRANT statements for anon/authenticated (not
-- recommended — this reopens the hole). There is no data to roll back;
-- this migration only changes privileges, not schema or rows.

REVOKE EXECUTE ON FUNCTION public.pos_complete_order(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pos_void_order(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pos_refund_order(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pos_receive_stock(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pos_adjust_stock(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pos_apply_stock_count(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pos_finalize_healthbox_settlement(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pos_mark_settlement_paid(jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.pos_complete_order(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_void_order(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_refund_order(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_receive_stock(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_adjust_stock(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_apply_stock_count(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_finalize_healthbox_settlement(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_mark_settlement_paid(jsonb) TO service_role;

-- pos_next_order_no() is called FROM INSIDE pos_complete_order (same
-- transaction, same SECURITY DEFINER context) — it never needs to be
-- callable directly by anon/authenticated either.
REVOKE EXECUTE ON FUNCTION public.pos_next_order_no() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_next_order_no() TO service_role;
