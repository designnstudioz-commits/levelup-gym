-- Matches CLAUDE.md's "Send SMS: Owner/Manager/Receptionist" row. Currently
-- only exercised by the receptionist dashboard's reminder-prepare flow.
ALTER TABLE public.sms_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "front-desk manage sms_log"
  ON public.sms_log FOR ALL
  TO authenticated
  USING (current_role_in(ARRAY['owner','manager','receptionist']))
  WITH CHECK (current_role_in(ARRAY['owner','manager','receptionist']));
