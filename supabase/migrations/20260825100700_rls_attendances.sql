-- Daily-operational table. Trainer is included in both policies — unlike
-- most other tables, CLAUDE.md's own matrix already says
-- "View attendance: Owner/Manager/Receptionist/Trainer" (viewer is the one
-- excluded role here), and dashboard/page.tsx's TrainerDashboard genuinely
-- reads today's attendance count, so this one row of the matrix is honored
-- literally rather than reconciled against NAV_ROLES.
ALTER TABLE public.attendances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ops read attendances"
  ON public.attendances FOR SELECT
  TO authenticated
  USING (current_role_in(ARRAY['owner','manager','receptionist','trainer']));

CREATE POLICY "ops insert attendances"
  ON public.attendances FOR INSERT
  TO authenticated
  WITH CHECK (current_role_in(ARRAY['owner','manager','receptionist','trainer']));

-- No UPDATE/DELETE policy — attendance rows are immutable by design (the
-- table has no deleted_at column at all). Device-sync writes come from
-- /api/attendance/fdata via the service-role key, unaffected by RLS either way.
