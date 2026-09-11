-- Audit trail — only ever read from the client on the owner-gated Settings
-- page, so SELECT is owner-only. INSERT stays open to any authenticated
-- role (every action from every role writes an audit entry, per CLAUDE.md
-- rule "every user action must create a row in activity_logs"), but WITH
-- CHECK pins user_id to the caller's own id so one authenticated user can't
-- forge a log entry attributed to someone else — every existing call site
-- already only ever sends its own currentUser.id, so this is pure
-- hardening, not a behavior change.
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- Phase H fix: bare current_role() = 'owner' fails to parse here — see
-- 20260825100100_rls_system_users.sql's comment (CURRENT_ROLE is a
-- reserved SQL keyword). Routed through current_role_in() instead.
CREATE POLICY "owner read activity_logs"
  ON public.activity_logs FOR SELECT
  TO authenticated
  USING (current_role_in(ARRAY['owner']));

CREATE POLICY "authenticated log own actions"
  ON public.activity_logs FOR INSERT
  TO authenticated
  WITH CHECK (user_id = current_system_user_id() OR user_id IS NULL);

-- No UPDATE/DELETE — logs are immutable by design (no deleted_at column).
