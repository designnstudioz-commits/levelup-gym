-- Device cluster (1 of 4: unverified_attendances, devices, device_commands,
-- device_enrollments) — admin/front-desk device-management tables, tested
-- together as one enrollment/resolve workflow after this lands.
ALTER TABLE public.unverified_attendances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "front-desk read unverified_attendances"
  ON public.unverified_attendances FOR SELECT
  TO authenticated
  USING (current_role_in(ARRAY['owner','manager','receptionist']));

CREATE POLICY "front-desk resolve unverified_attendances"
  ON public.unverified_attendances FOR UPDATE
  TO authenticated
  USING (current_role_in(ARRAY['owner','manager','receptionist']))
  WITH CHECK (current_role_in(ARRAY['owner','manager','receptionist']));

-- No client INSERT (device sync via /api/attendance/fdata is service-role)
-- and no DELETE anywhere in the app.
