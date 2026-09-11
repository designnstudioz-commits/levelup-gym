-- Highest-blast-radius table in the whole RLS rollout — every page load
-- bootstraps the caller's role through this table (dashboard/layout.tsx),
-- so this migration is applied and fully tested (all 5 roles, all 8 real
-- accounts) BEFORE any other table's RLS is touched. If something is wrong
-- here, `ALTER TABLE public.system_users DISABLE ROW LEVEL SECURITY;`
-- instantly reverts to today's fully-open behavior with nothing else
-- affected, since no other table's policy has shipped yet.
--
-- Also closes the single highest-severity finding of this whole audit:
-- src/app/dashboard/settings/SettingsClient.tsx does a direct browser-client
-- UPDATE system_users SET role=... to let an owner edit another user's
-- role. With no RLS, ANY authenticated user — including a trainer —
-- could currently grant themselves owner via a direct REST call, bypassing
-- the UI entirely. The UPDATE policy below is what actually stops that.
ALTER TABLE public.system_users ENABLE ROW LEVEL SECURITY;

-- Broad authenticated read is required for: (a) every page's own-role
-- bootstrap lookup, (b) "collected by / reviewed by / handled by" name
-- joins used throughout the app (e.g. PaymentDetailModal), (c) the Settings
-- page's full user list. RLS is row-level, not column-level — there's no
-- way to grant "own row in full, other rows name-only" with a single
-- policy. Accepted tradeoff: this is internal staff-directory data (name/
-- email/role of gym staff), not customer PII.
CREATE POLICY "authenticated read all system_users"
  ON public.system_users FOR SELECT
  TO authenticated
  USING (true);

-- Owner-only write — this is the policy that closes the self-promotion hole.
--
-- Phase H fix: written and tested at apply time as bare current_role() =
-- 'owner', which fails with "syntax error at or near (" — CURRENT_ROLE is
-- a reserved SQL keyword (a niladic alias for CURRENT_USER) and the parser
-- rejects it followed by parentheses in this position, even though it
-- resolves to this file's own public.current_role() function everywhere
-- else (inside a plain SQL function body, a different grammar context).
-- Routed through current_role_in() instead, which has no such conflict.
CREATE POLICY "owner manage system_users"
  ON public.system_users FOR UPDATE
  TO authenticated
  USING (current_role_in(ARRAY['owner']))
  WITH CHECK (current_role_in(ARRAY['owner']));

-- No INSERT/DELETE policy at all, for anon or authenticated — account
-- creation/deletion only ever happens via /api/admin/create-user and
-- /api/admin/delete-user, both using the service-role key, which bypasses
-- RLS entirely regardless of what's granted here.
