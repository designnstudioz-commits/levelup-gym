-- Phase F — HealthBox Expenses + Expense Approval.
--
-- pos_healthbox_expenses already existed (pre-planned in an earlier phase)
-- with exactly the category/status shape this phase needs. This migration
-- only adds what's missing, additively:
--
--   1. management_note — a general reviewer note distinct from
--      rejection_reason (which stays specifically "why rejected"). Used on
--      approval too, and on the new needs_correction status below.
--   2. 'needs_correction' status — lets Owner/Manager send an expense back
--      for a fix instead of an outright reject. Extending a CHECK
--      constraint's allowed values is the additive-enum pattern (never
--      remove a value, only add).
--   3. A PRIVATE storage bucket for receipt/proof uploads. Every existing
--      bucket (member-photos, member-docs, pos-products) is public — fine
--      for photos and product images, wrong for financial proof documents.
--      This bucket is public=false; files are only ever reached through a
--      server-side signed URL (service role bypasses storage RLS, so no
--      bucket policies are needed — access control lives entirely in the
--      Next.js API route that mints the signed URL).

ALTER TABLE pos_healthbox_expenses ADD COLUMN IF NOT EXISTS management_note TEXT;

ALTER TABLE pos_healthbox_expenses DROP CONSTRAINT IF EXISTS pos_healthbox_expenses_status_check;
ALTER TABLE pos_healthbox_expenses ADD CONSTRAINT pos_healthbox_expenses_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'needs_correction'::text]));

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('pos-healthbox-receipts', 'pos-healthbox-receipts', false, 5242880, ARRAY['image/jpeg','image/png','image/webp','application/pdf'])
ON CONFLICT (id) DO NOTHING;
