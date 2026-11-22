-- Record WHICH service a fee payment was collected against.
--
-- payment_type is a six-value accounting category (membership, trainer,
-- admission, nutritionist, physiotherapy, other) and its CHECK constraint is
-- left exactly as it is. Reception needs something different: to take money
-- for a sauna session, a boxing class or any of the 24 services in the
-- packages table, and to see afterwards what each payment was for.
--
-- Widening the CHECK was the obvious move and is the wrong one. It would mean
-- a migration every time the gym adds a service, duplicate the packages table
-- in a constraint, and — the real damage — let service income land in
-- payment_type values that revenue reports, fee status and trainer commission
-- all group by. A sauna payment must not read as membership revenue.
--
-- So the service is a new, separate dimension. payment_type keeps meaning
-- what it has always meant and every existing report keeps working untouched.

ALTER TABLE public.fee_payments
  ADD COLUMN IF NOT EXISTS service_package_id UUID REFERENCES public.packages(id);

-- Denormalised on purpose. The package may later be renamed or retired, and a
-- receipt printed last year must keep saying what was actually sold. Same
-- reasoning as expenses.expense_head holding text rather than a foreign key.
ALTER TABLE public.fee_payments
  ADD COLUMN IF NOT EXISTS service_name TEXT;

-- Partial: the overwhelming majority of rows are ordinary membership
-- payments with no service attached, and they should not bloat the index.
CREATE INDEX IF NOT EXISTS idx_fee_payments_service
  ON public.fee_payments (service_package_id)
  WHERE service_package_id IS NOT NULL;

COMMENT ON COLUMN public.fee_payments.service_package_id IS
  'Optional: the specific service this payment was collected against. NULL for ordinary membership/admission/trainer payments.';
COMMENT ON COLUMN public.fee_payments.service_name IS
  'Snapshot of the service name at the time of collection, so a renamed or retired package does not rewrite history.';

-- Nothing is backfilled. 1,902 existing payments predate this column and
-- there is no record of which service they were for; inventing one would be
-- worse than leaving it blank. They keep showing their payment_type tag.

-- Verify after running:
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name='fee_payments' AND column_name LIKE 'service%';
-- SELECT count(*) FROM fee_payments WHERE service_package_id IS NOT NULL;  -- 0 at first
