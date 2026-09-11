-- Device cluster (3 of 4) — read-only from the client (command lifecycle,
-- pushes, and acks are entirely service-role: /api/devices/push-user,
-- /api/attendance/devicecmd, /api/attendance/getrequest).
ALTER TABLE public.device_commands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "front-desk read device_commands"
  ON public.device_commands FOR SELECT
  TO authenticated
  USING (current_role_in(ARRAY['owner','manager','receptionist']));

-- No INSERT/UPDATE/DELETE policy — none of these ever happen from the
-- client; only the service-role key writes this table.
