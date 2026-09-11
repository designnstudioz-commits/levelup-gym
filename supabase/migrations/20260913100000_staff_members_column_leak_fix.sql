-- Adversarial security audit (post-Phase-H) — CRITICAL fix.
--
-- LIVE-CONFIRMED EXPLOIT: 20260825100400_rls_staff_members.sql's own comment
-- already warned that RLS is row-level only and cannot hide columns, and
-- said the app-code narrowing in Step3Services.tsx/Step4Review.tsx was the
-- "companion fix" — but that only protects the app's OWN query. A direct
-- REST call to PostgREST with select=* (trivial for anyone holding the
-- public anon key, which ships in the browser bundle) still returns every
-- column, INCLUDING salary and cnic, for every active Trainer. Reproduced
-- live during this audit: `anon.from("staff_members").select("*")` on an
-- active trainer row returned salary and cnic with zero authentication.
--
-- A second, worse instance of the same class was found in actual app code,
-- not just a hypothetical direct-API attack: dashboard/members/[id]/page.tsx
-- embeds `trainer:staff_members!members_trainer_id_fkey(*)` when loading a
-- member profile — a full-row join with no column narrowing. Receptionist
-- has access to this page (Phase H's own unblock-access work confirmed
-- receptionist's role there), so every receptionist viewing any member's
-- profile was pulling that member's trainer's salary and CNIC into the
-- browser on an entirely ordinary page load, no attack required.
--
-- A third, broader instance: "authenticated read all staff" USING (true)
-- meant any logged-in role — trainer, receptionist, cashier,
-- healthbox_staff, viewer — could also pull salary/cnic for every OTHER
-- staff member directly, not just their own, via the same direct-REST-call
-- technique.
--
-- FIX: RLS cannot restrict columns, so column-level exposure has to be
-- closed with a safe view instead — the same tool Postgres provides for
-- exactly this problem. Two narrow views (id/full_name/role/photo/bio only,
-- never salary/cnic/device_user_id) replace all non-owner/manager access
-- paths to this table. Owner/manager keep full-table access via the
-- existing pattern (they still legitimately need salary for payroll).
--
-- Companion app-code changes (same commit): Step3Services.tsx,
-- Step4Review.tsx, dashboard/daily-members/page.tsx, and
-- dashboard/members/[id]/page.tsx are repointed at these views instead of
-- the base table / instead of a `(*)` embed.

-- 1. Anon-safe view — matches the original "anon read active trainers" row
--    scope exactly (status='active' AND role='Trainer'), safe columns only.
CREATE VIEW public.staff_trainers_public AS
SELECT id, full_name, photo_url, specialization, bio
FROM public.staff_members
WHERE status = 'active' AND role = 'Trainer' AND deleted_at IS NULL;

GRANT SELECT ON public.staff_trainers_public TO anon, authenticated;

-- 2. Authenticated-non-admin directory — any active staff, safe columns
--    only. Covers the receptionist-reachable trainer/nutritionist pickers
--    that used to run select("*") against the base table.
CREATE VIEW public.staff_directory_public AS
SELECT id, full_name, role, photo_url, specialization, bio, status
FROM public.staff_members
WHERE deleted_at IS NULL;

GRANT SELECT ON public.staff_directory_public TO authenticated;

-- 3. Anon no longer gets any grant on the base table at all — the view is
--    now the only anon-facing surface.
REVOKE SELECT ON public.staff_members FROM anon;
DROP POLICY IF EXISTS "anon read active trainers" ON public.staff_members;

-- 4. Authenticated base-table SELECT narrows to owner/manager only — every
--    other role now goes through staff_directory_public instead.
DROP POLICY IF EXISTS "authenticated read all staff" ON public.staff_members;

CREATE POLICY "owner manager read all staff columns"
  ON public.staff_members FOR SELECT
  TO authenticated
  USING (current_role_in(ARRAY['owner','manager']));
