-- Foundation for the whole RLS rollout (this file + one migration per table
-- that follows). RLS is currently disabled on every table in this database
-- — the public anon key can read/write everything with zero auth. This file
-- creates nothing that changes behavior on its own; it's pure setup.
--
-- All three helpers key off email (auth.jwt() ->> 'email'), matching the
-- app's own existing role-lookup convention exactly (dashboard/layout.tsx,
-- useRoleGuard.ts, api/admin/create-user/route.ts all do
-- .eq("email", user.email.toLowerCase())) — deliberately NOT auth.uid().
-- Verified live: system_users.id matches auth.users.id for 7 of 8 accounts,
-- but sitedes@gmail.com has a mismatched id (pre-existing data issue, not
-- fixed here — fixing it means cascading FK updates across ~10 tables that
-- reference system_users(id), out of scope for a security migration).
-- Keying off email instead sidesteps that mismatch entirely.
--
-- SECURITY DEFINER is required specifically because a policy ON system_users
-- needs to query system_users to know the caller's role — without DEFINER,
-- that inner lookup is itself subject to the very policy being evaluated,
-- and Postgres either throws "infinite recursion detected in policy for
-- relation system_users" or silently self-constrains. Running as DEFINER
-- (owner privilege) breaks that cycle for just this one internal lookup.
--
-- SET search_path pins name resolution so a caller can't hijack an
-- unqualified reference inside a DEFINER function by creating their own
-- schema/table and manipulating their own session's search_path.

CREATE OR REPLACE FUNCTION public.current_system_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id
  FROM public.system_users
  WHERE lower(email) = lower(auth.jwt() ->> 'email')
    AND status = 'active'
    AND deleted_at IS NULL
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT role
  FROM public.system_users
  WHERE lower(email) = lower(auth.jwt() ->> 'email')
    AND status = 'active'
    AND deleted_at IS NULL
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_staff_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT staff_id
  FROM public.system_users
  WHERE lower(email) = lower(auth.jwt() ->> 'email')
    AND status = 'active'
    AND deleted_at IS NULL
  LIMIT 1;
$$;

-- Convenience wrapper so every table policy below can write
-- current_role_in(ARRAY['owner','manager']) instead of repeating
-- current_role() = 'owner' OR current_role() = 'manager' everywhere.
CREATE OR REPLACE FUNCTION public.current_role_in(roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.current_role() = ANY(roles);
$$;

-- No PUBLIC grant — anon never has a system_users row and no anon-facing
-- policy needs role information, only `authenticated` sessions call these.
REVOKE ALL ON FUNCTION public.current_system_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_role()            FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_staff_id()         FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_role_in(text[])    FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.current_system_user_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_role()            TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_staff_id()         TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_role_in(text[])    TO authenticated;
