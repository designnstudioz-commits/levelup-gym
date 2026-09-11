-- Public-facing (the /register form shows active trainers to anonymous
-- visitors so applicants can pick one). Row-level policy only controls
-- WHICH rows anon can see — it does NOT stop those rows returning every
-- column (salary, cnic, device_user_id) for a "select *" caller. That's a
-- companion app-code fix, shipped in the same commit as this migration:
-- src/components/forms/registration/Step3Services.tsx and Step4Review.tsx
-- narrow their anon-facing staff_members queries to
-- .select("id, full_name") instead of select("*"). RLS alone cannot close
-- a column-level leak — it is row-level only.
ALTER TABLE public.staff_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon read active trainers"
  ON public.staff_members FOR SELECT
  TO anon
  USING (status = 'active' AND role = 'Trainer');

CREATE POLICY "authenticated read all staff"
  ON public.staff_members FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "owner manager manage staff"
  ON public.staff_members FOR ALL
  TO authenticated
  USING (current_role_in(ARRAY['owner','manager']))
  WITH CHECK (current_role_in(ARRAY['owner','manager']));
