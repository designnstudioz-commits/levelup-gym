-- Walk-in/day-pass registration — matches CLAUDE.md's "Add members" row
-- (a walk-in is a lightweight form of member creation).
ALTER TABLE public.daily_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "front-desk manage daily_members"
  ON public.daily_members FOR ALL
  TO authenticated
  USING (current_role_in(ARRAY['owner','manager','receptionist']))
  WITH CHECK (current_role_in(ARRAY['owner','manager','receptionist']));
