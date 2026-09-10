-- Phase 3D — initial category structure.
--
-- NO RLS IN THIS FILE.
--
-- This is real, permanent business data (the launch catalogue's category
-- structure), not temporary test data — unlike the various TEST- product
-- seeds used for smoke testing, which were deliberately run as one-off
-- scripts outside supabase/migrations/, this belongs in a migration the
-- same way the four departments themselves were seeded in Phase A
-- (20260909100700_pos_seed.sql).
--
-- Idempotent by construction: each INSERT is guarded by a NOT EXISTS check
-- on (department_id, name) rather than ON CONFLICT, because pos_categories
-- has no unique constraint on that pair (categories are user-editable from
-- Phase D's admin UI, and forcing a uniqueness constraint on `name` would
-- block an owner from later renaming into a would-be duplicate). Re-running
-- this file is safe either way — it only ever adds a category that does
-- not already exist under that department by that exact name.
--
-- Not exhaustive, not final — this is a starting structure the owner is
-- expected to edit from /dashboard/pos/catalog/categories, not a locked
-- taxonomy. Unlike the four departments, categories are freely
-- creatable/editable/reorderable by design.

DO $$
DECLARE
  v_dept_id uuid;
  v_name    text;
  v_sort    int;
BEGIN
  -- Supplements
  SELECT id INTO v_dept_id FROM public.pos_departments WHERE slug = 'supplements';
  IF v_dept_id IS NOT NULL THEN
    v_sort := 0;
    FOREACH v_name IN ARRAY ARRAY['Protein', 'BCAA / EAA', 'Pre-Workout', 'Creatine', 'Vitamins', 'Other']
    LOOP
      v_sort := v_sort + 1;
      INSERT INTO public.pos_categories (department_id, name, sort_order)
      SELECT v_dept_id, v_name, v_sort
      WHERE NOT EXISTS (
        SELECT 1 FROM public.pos_categories
        WHERE department_id = v_dept_id AND name = v_name AND deleted_at IS NULL
      );
    END LOOP;
  END IF;

  -- Level Up Cafe
  SELECT id INTO v_dept_id FROM public.pos_departments WHERE slug = 'levelup-cafe';
  IF v_dept_id IS NOT NULL THEN
    v_sort := 0;
    FOREACH v_name IN ARRAY ARRAY['Drinks & Hydration', 'Bars', 'Boosters']
    LOOP
      v_sort := v_sort + 1;
      INSERT INTO public.pos_categories (department_id, name, sort_order)
      SELECT v_dept_id, v_name, v_sort
      WHERE NOT EXISTS (
        SELECT 1 FROM public.pos_categories
        WHERE department_id = v_dept_id AND name = v_name AND deleted_at IS NULL
      );
    END LOOP;
  END IF;

  -- Accessories
  SELECT id INTO v_dept_id FROM public.pos_departments WHERE slug = 'accessories';
  IF v_dept_id IS NOT NULL THEN
    v_sort := 0;
    FOREACH v_name IN ARRAY ARRAY['Shakers', 'Gloves', 'Straps', 'Towels', 'Other']
    LOOP
      v_sort := v_sort + 1;
      INSERT INTO public.pos_categories (department_id, name, sort_order)
      SELECT v_dept_id, v_name, v_sort
      WHERE NOT EXISTS (
        SELECT 1 FROM public.pos_categories
        WHERE department_id = v_dept_id AND name = v_name AND deleted_at IS NULL
      );
    END LOOP;
  END IF;

  -- HealthBox
  SELECT id INTO v_dept_id FROM public.pos_departments WHERE slug = 'healthbox';
  IF v_dept_id IS NOT NULL THEN
    v_sort := 0;
    FOREACH v_name IN ARRAY ARRAY['Burrito Bowls', 'Fresh Salads', 'Signature Sandwiches', 'Signature Wraps', 'Quesadilla Wraps', 'Signature Shakes']
    LOOP
      v_sort := v_sort + 1;
      INSERT INTO public.pos_categories (department_id, name, sort_order)
      SELECT v_dept_id, v_name, v_sort
      WHERE NOT EXISTS (
        SELECT 1 FROM public.pos_categories
        WHERE department_id = v_dept_id AND name = v_name AND deleted_at IS NULL
      );
    END LOOP;
  END IF;
END $$;
