-- Automatic fee-based device-access blocking + manual owner/manager
-- exemption override. Mirrors frozen_until/freeze_reason for current-state
-- columns and family_approved_by/family_approved_at for audit columns.
-- activity_logs is the event-history audit trail; these columns only ever
-- hold CURRENT state.

ALTER TABLE members ADD COLUMN IF NOT EXISTS access_exempt BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE members ADD COLUMN IF NOT EXISTS access_exempt_reason TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS access_exempt_by UUID REFERENCES system_users(id);
ALTER TABLE members ADD COLUMN IF NOT EXISTS access_exempt_at TIMESTAMPTZ;

-- NULL = not currently blocked. Written ONLY by server-side/service-role
-- code (cron sweep, manual-override force-unlock, post-payment sync route)
-- — the trigger below stops a client (even an owner's own browser) from
-- setting this directly; it must only ever reflect an actual device push.
ALTER TABLE members ADD COLUMN IF NOT EXISTS access_blocked_at TIMESTAMPTZ;
ALTER TABLE members ADD COLUMN IF NOT EXISTS access_blocked_reason TEXT
  CHECK (access_blocked_reason IN ('expired', 'unpaid') OR access_blocked_reason IS NULL);

CREATE INDEX IF NOT EXISTS idx_members_access_blocked
  ON members(access_blocked_at) WHERE access_blocked_at IS NOT NULL;

-- Self-contained on purpose (does NOT depend on current_role_in() from the
-- separate RLS-helper-functions migration in supabase/migrations/
-- 20260825100000_rls_helper_functions.sql) — inlines its own SECURITY
-- DEFINER role lookup so this works regardless of whether that RLS
-- rollout has landed yet, and real protection ships immediately (triggers
-- fire independent of a table's RLS status).
CREATE OR REPLACE FUNCTION public.enforce_access_control_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_role text;
BEGIN
  IF auth.role() = 'authenticated' THEN
    IF (NEW.access_blocked_at IS DISTINCT FROM OLD.access_blocked_at
        OR NEW.access_blocked_reason IS DISTINCT FROM OLD.access_blocked_reason) THEN
      RAISE EXCEPTION 'access_blocked_at/access_blocked_reason can only be set by the server';
    END IF;
    IF (NEW.access_exempt IS DISTINCT FROM OLD.access_exempt
        OR NEW.access_exempt_reason IS DISTINCT FROM OLD.access_exempt_reason) THEN
      SELECT role INTO caller_role FROM public.system_users
        WHERE lower(email) = lower(auth.jwt() ->> 'email') AND status = 'active' AND deleted_at IS NULL
        LIMIT 1;
      IF caller_role IS DISTINCT FROM 'owner' AND caller_role IS DISTINCT FROM 'manager' THEN
        RAISE EXCEPTION 'Only owner/manager may change access exemption';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_access_control_columns ON public.members;
CREATE TRIGGER enforce_access_control_columns
  BEFORE UPDATE ON public.members
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_access_control_columns();

-- Verify after running:
-- SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name = 'members' AND column_name LIKE 'access_%';
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'members'::regclass;
