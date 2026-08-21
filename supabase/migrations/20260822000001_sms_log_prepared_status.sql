-- Adds 'prepared' as an allowed sms_log.status value — represents a
-- reminder a receptionist has logged from the Front Desk Command Center
-- (recipient, message, type all recorded) but that was never actually
-- dispatched, since no SMS/WhatsApp/email gateway integration exists yet.
-- Deliberately NOT reusing 'queued' — that already implies "waiting for a
-- real sender to pick it up," which would be misleading with nothing
-- listening on the other end. When a real integration is added later, the
-- same rows can transition prepared -> queued -> sent/failed.
--
-- The original CHECK was defined inline/unnamed at table creation
-- (20260604000000_initial_schema.sql), so Postgres auto-named it — found
-- and dropped by pattern match rather than a guessed name, then recreated
-- as a superset (no existing rows can violate the new, wider constraint).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'sms_log'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE sms_log DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE sms_log ADD CONSTRAINT sms_log_status_check
  CHECK (status IN ('prepared', 'queued', 'sent', 'failed'));
