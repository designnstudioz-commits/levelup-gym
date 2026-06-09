-- Add packages for services that had no matching package
-- Fees are placeholder (Rs 5,000/mo) — update via the Packages admin page

INSERT INTO packages (name, type, duration_months, admission_fee, monthly_fee, max_members, services_included, status)
VALUES
  ('Zumba',           'Individual', 1, 15000, 5000, 1, ARRAY['Zumba'],           'active'),
  ('Nutritionist',    'Individual', 1, 0,     5000, 1, ARRAY['Nutritionist'],    'active'),
  ('Physiotherapy',   'Individual', 1, 0,     5000, 1, ARRAY['Physiotherapy'],   'active'),
  ('Paid Locker',     'Individual', 1, 0,     5000, 1, ARRAY['Paid Locker'],     'active'),
  ('Shower Facility', 'Individual', 1, 0,     5000, 1, ARRAY['Shower Facility'], 'active');
