-- Public-facing table (the /register form writes here unauthenticated) —
-- second-highest "silent breakage" risk in the rollout after system_users,
-- since a mistake could go unnoticed longer on a public-facing flow than an
-- internal dashboard page. Applied and tested (full anonymous registration
-- end to end) before moving on to any authenticated-only table.
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;

-- Public registration (src/components/forms/registration/index.tsx) inserts
-- unauthenticated. WITH CHECK blocks a crafted REST payload from pre-filling
-- staff-only fields the real form never sends (status, approval fields,
-- assigned package/trainer, dates, fees) — an anon submitter can only ever
-- create a bare pending application, never self-approve or backdate one.
CREATE POLICY "anon submit registration"
  ON public.submissions FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    status = 'pending'
    AND handled_by IS NULL AND reviewed_by IS NULL AND reviewed_at IS NULL
    AND package_id IS NULL AND trainer_id IS NULL
    AND joining_date IS NULL AND expiry_date IS NULL
    AND admission_fee IS NULL AND monthly_fee IS NULL
    AND payment_method IS NULL AND submitted_by IS NULL
  );

-- Phase H fix, found by actually running the anonymous registration flow
-- end to end (never tested before this): the real form
-- (registration/index.tsx) chains .select("id") after the INSERT above to
-- get the new row's id back. Supabase-js's insert-then-select needs a
-- SELECT policy too — the INSERT's WITH CHECK alone let the row get
-- created, but the read-back failed with "violates row-level security
-- policy" and the whole call errored, breaking registration entirely.
-- Scoped to status='pending' (mirrors the INSERT's own WITH CHECK) rather
-- than open-endedly: submission ids are random UUIDs, not enumerable, so
-- "anyone holding the id can read it while still pending" is the accepted
-- tradeoff — and once approved/rejected it stops being readable by anon
-- at all, which the id alone was never meant to unlock long-term anyway.
CREATE POLICY "anon read own pending submission"
  ON public.submissions FOR SELECT
  TO anon
  USING (status = 'pending');

-- Matches NAV_ROLES["/dashboard/submissions"] exactly (Sidebar.tsx) —
-- trainer/viewer excluded. Applicant PII (CNIC, medical notes, emergency
-- contact) with no approve permission to justify exposing it to those roles.
-- Note: the sidebar's pending-submissions badge (dashboard/layout.tsx, shown
-- on every page for every role) will now silently read 0 for trainer/viewer
-- instead of the real count — not a regression, since those roles never had
-- nav access to the submissions page itself either way.
CREATE POLICY "front-desk read submissions"
  ON public.submissions FOR SELECT
  TO authenticated
  USING (current_role_in(ARRAY['owner','manager','receptionist']));

-- Archive/reject-cleanup (soft delete) — matches submissions/page.tsx's own
-- existing canApprove = owner||manager UI gate exactly. Approve/reject
-- themselves already go through service-role API routes
-- (/api/submissions/approve, /api/submissions/reject), not a direct client
-- mutation, so this UPDATE policy only needs to cover archive/delete.
CREATE POLICY "owner manager archive submissions"
  ON public.submissions FOR UPDATE
  TO authenticated
  USING (current_role_in(ARRAY['owner','manager']))
  WITH CHECK (current_role_in(ARRAY['owner','manager']));

-- No DELETE policy — hard delete is never used from the client.
