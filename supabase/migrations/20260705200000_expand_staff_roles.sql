-- =============================================================================
-- Expand staff_members.role to include Software Developer, Designer, and
-- Freelancer alongside the existing gym-specific roles.
--
-- The original CHECK constraint (20260604000000_initial_schema.sql) only
-- allowed Trainer, Receptionist, Manager, Nutritionist, Other. Adding a
-- staff member with any other job title fails at the database level even
-- if the UI offered it, so the constraint has to be replaced, not just the
-- dropdown.
--
-- Note: staff_members.role is the job-title field shown on the Add/Edit
-- Staff forms — it's unrelated to system_users.role (owner/manager/
-- receptionist/trainer/viewer), which controls login permissions and is
-- untouched by this migration.
-- =============================================================================

ALTER TABLE staff_members DROP CONSTRAINT IF EXISTS staff_members_role_check;

ALTER TABLE staff_members ADD CONSTRAINT staff_members_role_check
  CHECK (role IN (
    'Trainer', 'Receptionist', 'Manager', 'Nutritionist',
    'Software Developer', 'Designer', 'Freelancer', 'Other'
  ));

-- Verify after running:
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'staff_members_role_check';
