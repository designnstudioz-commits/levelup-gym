-- Ad-hoc front-desk to-do items ("Call Ali about renewal", "Collect Hamza
-- balance") — the Front Desk Command Center's "My Tasks" section. No
-- existing table captures this; it's genuinely new, not a duplicate of
-- activity_logs (an immutable audit trail of what already happened) or
-- fee_payments.balance_due_date (a specific payment's due date, not a
-- freeform personal task).
CREATE TABLE staff_tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  member_id     UUID REFERENCES members(id),
  assigned_to   UUID REFERENCES system_users(id) NOT NULL,
  due_date      DATE,
  priority      TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'snoozed')),
  snoozed_until DATE,
  created_by    UUID REFERENCES system_users(id),
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX idx_staff_tasks_assigned_status
  ON staff_tasks (assigned_to, status)
  WHERE deleted_at IS NULL;
