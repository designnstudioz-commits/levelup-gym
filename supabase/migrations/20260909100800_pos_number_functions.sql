-- Phase 3 / Stage A — server-side issuance of user-facing POS numbers.
--
-- NO RLS IN THIS FILE (see 20260909100000 header).
--
-- These exist as database functions rather than application code because
-- nextval() cannot be called through PostgREST's table API, and because the
-- alternative — SELECT MAX(...) + 1 from the client — is exactly the race
-- that commit b891e03 had to fix in device_commands. A sequence is atomic
-- under concurrency and never reissues a number, which matters when the
-- number is printed on a customer's receipt.
--
-- Gaps are expected and harmless: a rolled-back transaction consumes a
-- value. These are identifiers, not counts.

-- 'LU-1042' — issued only at completion, so parked and abandoned baskets
-- never burn a customer-facing number.
CREATE OR REPLACE FUNCTION public.pos_next_order_no()
RETURNS text
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT 'LU-' || nextval('public.pos_order_no_seq')::text;
$$;

-- 'H-021' — issued when a basket is parked. Deliberately a separate series:
-- the approved Held Orders screen shows #H-021 while the completed order
-- for the same basket later shows #LU-1042, so a hold reference must never
-- be mistaken for a sale.
CREATE OR REPLACE FUNCTION public.pos_next_hold_ref()
RETURNS text
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT 'H-' || lpad(nextval('public.pos_hold_no_seq')::text, 3, '0');
$$;

-- Only authenticated sessions issue numbers. anon never transacts at the
-- POS; the public receipt route only ever reads an existing order_no.
REVOKE ALL ON FUNCTION public.pos_next_order_no()  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pos_next_hold_ref()  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_next_order_no() TO authenticated;
GRANT EXECUTE ON FUNCTION public.pos_next_hold_ref() TO authenticated;
