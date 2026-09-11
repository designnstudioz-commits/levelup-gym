-- Front Desk Command Center's "My Tasks" widget — self-scoped rather than
-- role-based, matching the actual query pattern in
-- ReceptionistDashboard.tsx exactly. Deliberately NOT role='receptionist':
-- that would let any receptionist see every other receptionist's tasks,
-- which the app itself never does today, and this degrades correctly if
-- another role ever gets a task widget later without needing a new policy.
ALTER TABLE public.staff_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own tasks"
  ON public.staff_tasks FOR ALL
  TO authenticated
  USING (assigned_to = current_system_user_id() OR created_by = current_system_user_id())
  WITH CHECK (assigned_to = current_system_user_id() OR created_by = current_system_user_id());
