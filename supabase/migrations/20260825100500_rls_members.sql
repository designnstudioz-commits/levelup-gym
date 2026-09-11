-- Largest surface in the app (~45 client-side call sites), but no anon
-- exposure — applied once the anon-facing cluster (submissions/packages/
-- staff_members) is proven stable.
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;

-- Viewer is included here matching TODAY'S actual working behavior
-- (NAV_ROLES["/dashboard/members"] already includes viewer, and
-- members/page.tsx has zero role gating) — a deliberate decision to not
-- break a currently-functioning page. See CLAUDE.md discussion / project
-- memory for the option to tighten this to a count-only view later.
CREATE POLICY "front-desk read all members"
  ON public.members FOR SELECT
  TO authenticated
  USING (current_role_in(ARRAY['owner','manager','receptionist','viewer']));

-- Mirrors the existing TrainerDashboard query pattern
-- (.eq("trainer_id", currentUser.staff_id)) as a real DB-level guarantee —
-- a trainer can only ever see members assigned to them.
CREATE POLICY "trainer read own assigned members"
  ON public.members FOR SELECT
  TO authenticated
  USING (trainer_id = current_staff_id());

-- Matches CLAUDE.md's "Add members" / "Delete/archive members" rows.
CREATE POLICY "front-desk add members"
  ON public.members FOR INSERT
  TO authenticated
  WITH CHECK (current_role_in(ARRAY['owner','manager','receptionist']));

CREATE POLICY "front-desk edit members"
  ON public.members FOR UPDATE
  TO authenticated
  USING (current_role_in(ARRAY['owner','manager','receptionist']))
  WITH CHECK (current_role_in(ARRAY['owner','manager','receptionist']));

-- No DELETE — archive is UPDATE deleted_at, covered above.
