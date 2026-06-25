-- Device command queue: dashboard → ZKTeco machine
-- Commands are delivered via /iclock/getrequest and acknowledged via /iclock/devicecmd

CREATE TABLE device_commands (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_serial   TEXT NOT NULL,
  command_id      INT NOT NULL,        -- numeric ID used in ADMS protocol C:id:command
  command         TEXT NOT NULL,       -- full command payload (tab-separated ADMS format)
  command_type    TEXT NOT NULL DEFAULT 'push_user',  -- push_user | delete_user | set_time | reboot
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'sent', 'acked', 'failed')),
  member_id       UUID REFERENCES members(id),
  created_by      UUID REFERENCES system_users(id),
  sent_at         TIMESTAMPTZ,
  acked_at        TIMESTAMPTZ,
  return_code     INT,                 -- 0 = success from device ACK
  error           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_device_commands_serial_status ON device_commands(device_serial, status);
CREATE INDEX idx_device_commands_member ON device_commands(member_id);
