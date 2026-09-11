-- Device cluster (4 of 4) — fingerprint/PIN enrollment records, managed
-- from member and staff detail pages.
ALTER TABLE public.device_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "front-desk manage device_enrollments"
  ON public.device_enrollments FOR ALL
  TO authenticated
  USING (current_role_in(ARRAY['owner','manager','receptionist']))
  WITH CHECK (current_role_in(ARRAY['owner','manager','receptionist']));
