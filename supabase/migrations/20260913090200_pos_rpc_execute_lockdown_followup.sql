-- Phase H — follow-up to 20260913090000: pos_next_hold_ref() was missed in
-- the first lockdown pass (the function list was built from the phases'
-- own migration history, not a live query against pg_proc — this one
-- predates that history). Re-auditing ALL pos_ functions via pg_proc
-- directly (not memory) turned it up: EXECUTE was still granted to
-- `authenticated` (though already correctly revoked from `anon`).
--
-- Lower severity than the original finding — this function only issues
-- the next sequential hold reference string, no financial data or writes
-- — but "RPC EXECUTE privileges explicitly restricted" means all of them,
-- not just the ones with obvious blast radius. Same fix, same reasoning.
--
-- pos_close_session and pos_review_session were also re-checked directly
-- against pg_proc and were already correctly restricted (part of the
-- original Phase 3B/C lockdown) — no change needed for those two.

REVOKE EXECUTE ON FUNCTION public.pos_next_hold_ref() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_next_hold_ref() TO service_role;
