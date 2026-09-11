-- Device cluster (2 of 4). SELECT is deliberately broad — DeviceStatusBanner
-- (src/components/layout/DeviceStatusBanner.tsx) renders on every dashboard
-- page for every role including viewer, so device status must stay visible
-- to all authenticated users even though management stays front-desk-only.
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read devices"
  ON public.devices FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "front-desk insert devices"
  ON public.devices FOR INSERT
  TO authenticated
  WITH CHECK (current_role_in(ARRAY['owner','manager','receptionist']));

CREATE POLICY "front-desk update devices"
  ON public.devices FOR UPDATE
  TO authenticated
  USING (current_role_in(ARRAY['owner','manager','receptionist']))
  WITH CHECK (current_role_in(ARRAY['owner','manager','receptionist']));

-- devices is the one table in the whole app with a genuine client-side hard
-- DELETE (src/app/dashboard/attendance/page.tsx, removing a device record)
-- — needs its own explicit policy, unlike every soft-delete-only table.
CREATE POLICY "front-desk delete devices"
  ON public.devices FOR DELETE
  TO authenticated
  USING (current_role_in(ARRAY['owner','manager','receptionist']));
