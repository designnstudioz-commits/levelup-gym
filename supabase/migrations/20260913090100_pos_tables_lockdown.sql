-- Phase H — CRITICAL FIX: lock down every pos_ table.
--
-- Audit finding: RLS was never enabled on ANY pos_ table, and every single
-- one grants full INSERT/SELECT/UPDATE/DELETE/TRUNCATE to `anon` AND
-- `authenticated` — Supabase's default table privileges, never revoked.
-- Since RLS was off, those grants were fully live: anyone with only the
-- public anon key (embedded in the client bundle, trivially extractable,
-- no login required) could read, write, or DELETE every row of every POS
-- table directly via the Supabase REST API — orders, payments, HealthBox
-- expenses, settlements, everything — completely bypassing this app,
-- requirePosUser(), and every access rule built across Phases B–G.
--
-- This is the single most severe finding of the Phase H audit, more severe
-- than the RPC EXECUTE gap fixed in 20260913090000 (that one needed a
-- forged caller_id to do anything; this one needs no authentication
-- whatsoever). Fixed the same way, for the same reason: nothing in this
-- app ever queries a pos_ table directly from the browser — grep across
-- src/app/dashboard and src/components confirms zero such call sites, only
-- Next.js API routes using the service-role client. So revoking all
-- privileges from anon/authenticated changes zero app behavior.
--
-- RLS is also enabled (with NO policies) as defense in depth: even if a
-- future grant is accidentally reintroduced, an enabled table with no
-- policy defaults to deny-all for any role without the BYPASSRLS
-- attribute. service_role has rolbypassrls = true (verified live), so
-- every existing API route is completely unaffected — this migration only
-- removes capabilities nothing in the app used, using its own key.
--
-- No new policies are written here — that would mean re-deriving every POS
-- authorization rule already implemented across ~30 API routes as SQL, a
-- genuine architecture change this phase explicitly rules out ("do not
-- redesign"). The service-role + requirePosUser() model IS the security
-- boundary for POS, by original design (see catalog.ts's Phase 3B header
-- comment) — this migration makes that actually airtight rather than
-- introducing a second, parallel enforcement layer.
--
-- Rollback: `GRANT ALL ON TABLE public.<table> TO anon, authenticated;`
-- and `ALTER TABLE public.<table> DISABLE ROW LEVEL SECURITY;` per table
-- (not recommended — this reopens the hole). No data is affected; this
-- migration only changes privileges.

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE 'pos_%'
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
