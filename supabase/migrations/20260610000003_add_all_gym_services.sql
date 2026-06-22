-- Add all common gym services as packages with dummy prices
INSERT INTO packages (name, type, duration_months, admission_fee, monthly_fee, max_members, services_included, status)
VALUES
  ('Cardio',            'Individual', 1, 0,     3500,  1, ARRAY['Cardio'],           'active'),
  ('Personal Training', 'Individual', 1, 0,     8000,  1, ARRAY['Personal Training'],'active'),
  ('METCON',            'Individual', 1, 0,     6000,  1, ARRAY['METCON'],           'active'),
  ('Boxing',            'Individual', 1, 0,     7000,  1, ARRAY['Boxing'],           'active'),
  ('Yoga',              'Individual', 1, 0,     5000,  1, ARRAY['Yoga'],             'active'),
  ('Kickboxing',        'Individual', 1, 0,     7000,  1, ARRAY['Kickboxing'],       'active'),
  ('Spinning',          'Individual', 1, 0,     4000,  1, ARRAY['Spinning'],         'active'),
  ('Sauna / Steam',     'Individual', 1, 0,     2500,  1, ARRAY['Sauna'],            'active'),
  ('Swimming',          'Individual', 1, 0,     6000,  1, ARRAY['Swimming'],         'active'),
  ('Pilates',           'Individual', 1, 0,     5500,  1, ARRAY['Pilates'],          'active'),
  ('Dance Fitness',     'Individual', 1, 0,     4500,  1, ARRAY['Dance Fitness'],    'active'),
  ('Stretching',        'Individual', 1, 0,     2000,  1, ARRAY['Stretching'],       'active');
