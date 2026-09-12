-- Follow-up to 20260913150000/150100 — closes a real gap found in a final
-- security pass before commit: the idempotency replay lookup matched on
-- registration_idempotency_key alone, with no check that the caller
-- presenting the key is the same actor who created the original
-- registration. In practice each client generates its own random UUID
-- per attempt, so an accidental cross-actor collision is not realistic —
-- but nothing in the function enforced that, so a key collision (by bug,
-- log exposure, or deliberate reuse) would have silently handed back
-- another actor's member_id/membership_no/payment ids instead of failing
-- safely. This scopes every replay path (the fast top-of-function lookup
-- AND the unique_violation fallback) to actor_id, and makes a genuine
-- cross-actor key collision a hard, safe error instead of a silent
-- cross-registration disclosure.

CREATE OR REPLACE FUNCTION public.find_idempotent_registration_result(p_idem_key UUID, p_actor_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_member_id     UUID;
  v_membership_no TEXT;
  v_admission_id  UUID;
  v_membership_id UUID;
BEGIN
  -- The actor check reads activity_logs.user_id from THIS row's own
  -- added_member log rather than a new column — that log is written in
  -- the same transaction as the member insert, so it's exactly as
  -- reliable a source of "who actually created this" as a dedicated
  -- column would be, with no schema change needed. IS NOT DISTINCT FROM
  -- (not =) so an anonymous/system actor (actor_id NULL) can still
  -- replay its own NULL-actor registration.
  SELECT m.id, m.membership_no INTO v_member_id, v_membership_no
  FROM public.members m
  WHERE m.registration_idempotency_key = p_idem_key
    AND EXISTS (
      SELECT 1 FROM public.activity_logs al
      WHERE al.entity_id = m.id AND al.entity_type = 'member' AND al.action = 'added_member'
        AND al.user_id IS NOT DISTINCT FROM p_actor_id
    );

  IF v_member_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_admission_id FROM public.fee_payments
    WHERE member_id = v_member_id AND payment_type = 'admission' AND deleted_at IS NULL
    ORDER BY created_at ASC LIMIT 1;
  SELECT id INTO v_membership_id FROM public.fee_payments
    WHERE member_id = v_member_id AND payment_type = 'membership' AND deleted_at IS NULL
    ORDER BY created_at ASC LIMIT 1;

  RETURN jsonb_build_object(
    'member_id', v_member_id,
    'membership_no', v_membership_no,
    'admission_payment_id', v_admission_id,
    'membership_payment_id', v_membership_id,
    'replayed', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.find_idempotent_registration_result(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_idempotent_registration_result(UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.register_member_with_payment(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_idem_key           UUID;
  v_actor_id           UUID;
  v_member             JSONB;
  v_admission          JSONB;
  v_membership         JSONB;
  v_commission         JSONB;
  v_replay             JSONB;

  v_member_id          UUID;
  v_membership_no      TEXT;
  v_prefix             TEXT;
  v_year               INT;
  v_next_seq           INT;
  v_row                RECORD;

  v_receipt_no         TEXT;
  v_line               JSONB;
  v_line_idx           INT;
  v_first_payment_id   UUID;
  v_admission_payment_id  UUID;
  v_membership_payment_id UUID;

  v_lines_total        NUMERIC;
  v_target             NUMERIC;
BEGIN
  v_idem_key   := NULLIF(payload->>'idempotency_key', '')::UUID;
  v_actor_id   := NULLIF(payload->>'actor_id', '')::UUID;
  v_member     := payload->'member';
  v_admission  := payload->'admission_payment';
  v_membership := payload->'membership_payment';
  v_commission := payload->'commission';

  IF v_idem_key IS NOT NULL THEN
    v_replay := public.find_idempotent_registration_result(v_idem_key, v_actor_id);
    IF v_replay IS NOT NULL THEN
      RETURN v_replay;
    END IF;
  END IF;

  IF v_member IS NULL THEN
    RAISE EXCEPTION 'member payload is required';
  END IF;
  IF COALESCE(v_member->>'full_name', '') = '' THEN
    RAISE EXCEPTION 'full_name is required';
  END IF;
  IF COALESCE(v_member->>'phone', '') = '' THEN
    RAISE EXCEPTION 'phone is required';
  END IF;

  IF v_admission IS NOT NULL THEN
    IF (v_admission->>'final_amount')::NUMERIC < 0 THEN
      RAISE EXCEPTION 'admission final_amount cannot be negative';
    END IF;
    IF jsonb_array_length(COALESCE(v_admission->'lines', '[]'::jsonb)) = 0 THEN
      RAISE EXCEPTION 'admission payment requires at least one payment line';
    END IF;
    v_lines_total := 0;
    FOR v_line IN SELECT * FROM jsonb_array_elements(v_admission->'lines') LOOP
      IF (v_line->>'amount')::NUMERIC <= 0 THEN
        RAISE EXCEPTION 'admission payment line amounts must be positive';
      END IF;
      IF NOT (v_line->>'method' = ANY (ARRAY['Cash','Bank','Card','EasyPaisa','JazzCash'])) THEN
        RAISE EXCEPTION 'invalid admission payment method: %', v_line->>'method';
      END IF;
      v_lines_total := v_lines_total + (v_line->>'amount')::NUMERIC;
    END LOOP;
    v_target := (v_admission->>'final_amount')::NUMERIC - COALESCE((v_admission->>'balance_due')::NUMERIC, 0);
    IF abs(v_lines_total - v_target) > 0.5 THEN
      RAISE EXCEPTION 'admission payment lines (%) do not reconcile with amount collected (%)', v_lines_total, v_target;
    END IF;
    IF COALESCE((v_admission->>'balance_due')::NUMERIC, 0) < 0 THEN
      RAISE EXCEPTION 'admission balance_due cannot be negative';
    END IF;
  END IF;

  IF v_membership IS NOT NULL THEN
    IF (v_membership->>'final_amount')::NUMERIC < 0 THEN
      RAISE EXCEPTION 'membership final_amount cannot be negative';
    END IF;
    IF jsonb_array_length(COALESCE(v_membership->'lines', '[]'::jsonb)) = 0 THEN
      RAISE EXCEPTION 'membership payment requires at least one payment line';
    END IF;
    v_lines_total := 0;
    FOR v_line IN SELECT * FROM jsonb_array_elements(v_membership->'lines') LOOP
      IF (v_line->>'amount')::NUMERIC <= 0 THEN
        RAISE EXCEPTION 'membership payment line amounts must be positive';
      END IF;
      IF NOT (v_line->>'method' = ANY (ARRAY['Cash','Bank','Card','EasyPaisa','JazzCash'])) THEN
        RAISE EXCEPTION 'invalid membership payment method: %', v_line->>'method';
      END IF;
      v_lines_total := v_lines_total + (v_line->>'amount')::NUMERIC;
    END LOOP;
    v_target := (v_membership->>'final_amount')::NUMERIC - COALESCE((v_membership->>'balance_due')::NUMERIC, 0);
    IF abs(v_lines_total - v_target) > 0.5 THEN
      RAISE EXCEPTION 'membership payment lines (%) do not reconcile with amount collected (%)', v_lines_total, v_target;
    END IF;
    IF COALESCE((v_membership->>'balance_due')::NUMERIC, 0) < 0 THEN
      RAISE EXCEPTION 'membership balance_due cannot be negative';
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('members.membership_no'));

  v_year := EXTRACT(YEAR FROM now())::INT;
  v_prefix := CASE WHEN v_member->>'gender' = 'Female' THEN 'LUF' ELSE 'LUM' END;
  v_next_seq := 1;
  FOR v_row IN
    SELECT membership_no FROM public.members
    WHERE membership_no LIKE 'LUM-' || v_year || '-%' OR membership_no LIKE 'LUF-' || v_year || '-%'
  LOOP
    v_next_seq := GREATEST(v_next_seq, COALESCE(NULLIF(split_part(v_row.membership_no, '-', 3), '')::INT, 0) + 1);
  END LOOP;
  v_membership_no := v_prefix || '-' || v_year || '-' || lpad(v_next_seq::TEXT, 4, '0');

  BEGIN
    INSERT INTO public.members (
      membership_no, full_name, secondary_name, dob, age, gender, marital_status,
      phone, whatsapp, email, cnic, address, blood_group, vaccinated, height, weight,
      medical_notes, emergency_name, emergency_phone, photo_url,
      package_id, package_ids, trainer_id, joining_date, membership_start_date, expiry_date,
      admission_fee, monthly_fee, training_fee, status,
      family_primary_member_id, family_relationship, family_notes,
      registration_idempotency_key
    ) VALUES (
      v_membership_no,
      v_member->>'full_name',
      NULLIF(v_member->>'secondary_name', ''),
      NULLIF(v_member->>'dob', '')::DATE,
      NULLIF(v_member->>'age', '')::INT,
      v_member->>'gender',
      NULLIF(v_member->>'marital_status', ''),
      v_member->>'phone',
      NULLIF(v_member->>'whatsapp', ''),
      NULLIF(v_member->>'email', ''),
      NULLIF(v_member->>'cnic', ''),
      NULLIF(v_member->>'address', ''),
      NULLIF(v_member->>'blood_group', ''),
      NULLIF(v_member->>'vaccinated', ''),
      NULLIF(v_member->>'height', ''),
      NULLIF(v_member->>'weight', ''),
      NULLIF(v_member->>'medical_notes', ''),
      NULLIF(v_member->>'emergency_name', ''),
      NULLIF(v_member->>'emergency_phone', ''),
      NULLIF(v_member->>'photo_url', ''),
      NULLIF(v_member->>'package_id', '')::UUID,
      CASE WHEN v_member->'package_ids' IS NOT NULL AND jsonb_array_length(v_member->'package_ids') > 0
        THEN (SELECT array_agg(value::UUID) FROM jsonb_array_elements_text(v_member->'package_ids'))
        ELSE NULL END,
      NULLIF(v_member->>'trainer_id', '')::UUID,
      NULLIF(v_member->>'joining_date', '')::DATE,
      NULLIF(v_member->>'membership_start_date', '')::DATE,
      NULLIF(v_member->>'expiry_date', '')::DATE,
      NULLIF(v_member->>'admission_fee', '')::NUMERIC,
      NULLIF(v_member->>'monthly_fee', '')::NUMERIC,
      NULLIF(v_member->>'training_fee', '')::NUMERIC,
      CASE WHEN (v_member->>'is_family_member')::BOOLEAN IS TRUE THEN 'pending_family_approval' ELSE 'active' END,
      NULLIF(v_member->>'family_primary_member_id', '')::UUID,
      NULLIF(v_member->>'family_relationship', ''),
      NULLIF(v_member->>'family_notes', ''),
      v_idem_key
    )
    RETURNING id INTO v_member_id;
  EXCEPTION WHEN unique_violation THEN
    -- Someone else's insert won the race on this exact idempotency_key.
    -- Only return their result if THEY are the same actor (see
    -- find_idempotent_registration_result) — otherwise this is a genuine
    -- cross-actor key collision, which must fail loudly, never silently
    -- hand back another actor's registration.
    IF v_idem_key IS NOT NULL THEN
      v_replay := public.find_idempotent_registration_result(v_idem_key, v_actor_id);
      IF v_replay IS NOT NULL THEN
        RETURN v_replay;
      END IF;
    END IF;
    RAISE EXCEPTION 'This registration reference was already used by a different session';
  END;

  INSERT INTO public.activity_logs (user_id, action, entity_type, entity_id, description, metadata)
  VALUES (
    v_actor_id, 'added_member', 'member', v_member_id,
    'Added new member ' || (v_member->>'full_name') || ' — ' || v_membership_no ||
      CASE WHEN (v_member->>'is_family_member')::BOOLEAN IS TRUE THEN ' (pending family approval)' ELSE '' END,
    jsonb_build_object(
      'membership_no', v_membership_no,
      'package_id', v_member->>'package_id',
      'is_family_member', COALESCE((v_member->>'is_family_member')::BOOLEAN, false),
      'family_primary_member_id', v_member->>'family_primary_member_id'
    )
  );

  IF v_commission IS NOT NULL THEN
    INSERT INTO public.trainer_member_commissions (trainer_id, member_id, commission_type, commission_percent, commission_amount, updated_by)
    VALUES (
      (v_commission->>'trainer_id')::UUID,
      v_member_id,
      v_commission->>'commission_type',
      (v_commission->>'commission_percent')::NUMERIC,
      NULLIF(v_commission->>'commission_amount', '')::NUMERIC,
      v_actor_id
    );
  END IF;

  IF v_admission IS NOT NULL AND (v_admission->>'final_amount')::NUMERIC > 0 THEN
    PERFORM pg_advisory_xact_lock(hashtext('fee_payments.receipt_no'));
    SELECT count(*) + 1 INTO v_next_seq FROM public.fee_payments;
    v_receipt_no := 'PMT-' || v_year || '-' || lpad(v_next_seq::TEXT, 4, '0');

    v_line_idx := 0;
    v_first_payment_id := NULL;
    FOR v_line IN SELECT * FROM jsonb_array_elements(v_admission->'lines') LOOP
      INSERT INTO public.fee_payments (
        member_id, amount, payment_type, payment_method, payment_date, month_covered,
        receipt_no, note, balance_due, balance_due_date, collected_by
      ) VALUES (
        v_member_id,
        (v_line->>'amount')::NUMERIC,
        'admission',
        v_line->>'method',
        CURRENT_DATE,
        NULL,
        v_receipt_no,
        NULLIF(v_admission->>'note', ''),
        CASE WHEN v_line_idx = 0 THEN COALESCE((v_admission->>'balance_due')::NUMERIC, 0) ELSE 0 END,
        CASE WHEN v_line_idx = 0 AND COALESCE((v_admission->>'balance_due')::NUMERIC, 0) > 0
          THEN NULLIF(v_admission->>'balance_due_date', '')::DATE ELSE NULL END,
        v_actor_id
      )
      RETURNING id INTO v_admission_payment_id;
      IF v_first_payment_id IS NULL THEN v_first_payment_id := v_admission_payment_id; END IF;
      v_line_idx := v_line_idx + 1;
    END LOOP;
    v_admission_payment_id := v_first_payment_id;

    INSERT INTO public.activity_logs (user_id, action, entity_type, entity_id, description, metadata)
    VALUES (
      v_actor_id, 'paid_fee', 'member', v_member_id,
      (v_member->>'full_name') || ' paid ' || to_char((v_admission->>'final_amount')::NUMERIC - COALESCE((v_admission->>'balance_due')::NUMERIC,0), 'FM999,999,999') || ' (admission) — ' || v_receipt_no ||
        CASE WHEN COALESCE((v_admission->>'balance_due')::NUMERIC, 0) > 0
          THEN ' — ' || to_char((v_admission->>'balance_due')::NUMERIC, 'FM999,999,999') || ' balance due' ELSE '' END,
      jsonb_build_object(
        'original', COALESCE((v_admission->>'original_amount')::NUMERIC, 0),
        'discount', COALESCE((v_admission->>'discount_amount')::NUMERIC, 0),
        'final', (v_admission->>'final_amount')::NUMERIC,
        'collected', (v_admission->>'final_amount')::NUMERIC - COALESCE((v_admission->>'balance_due')::NUMERIC,0),
        'balanceDue', COALESCE((v_admission->>'balance_due')::NUMERIC, 0),
        'receipt_no', v_receipt_no
      )
    );
  END IF;

  IF v_membership IS NOT NULL AND (v_membership->>'final_amount')::NUMERIC > 0 THEN
    PERFORM pg_advisory_xact_lock(hashtext('fee_payments.receipt_no'));
    SELECT count(*) + 1 INTO v_next_seq FROM public.fee_payments;
    v_receipt_no := 'PMT-' || v_year || '-' || lpad(v_next_seq::TEXT, 4, '0');

    v_line_idx := 0;
    v_first_payment_id := NULL;
    FOR v_line IN SELECT * FROM jsonb_array_elements(v_membership->'lines') LOOP
      INSERT INTO public.fee_payments (
        member_id, amount, payment_type, payment_method, payment_date, month_covered,
        coverage_start, coverage_end, receipt_no, note, balance_due, balance_due_date,
        package_breakdown, collected_by
      ) VALUES (
        v_member_id,
        (v_line->>'amount')::NUMERIC,
        'membership',
        v_line->>'method',
        CURRENT_DATE,
        CURRENT_DATE,
        CASE WHEN v_line_idx = 0 THEN NULLIF(v_membership->>'coverage_start', '')::DATE ELSE NULL END,
        CASE WHEN v_line_idx = 0 THEN NULLIF(v_membership->>'coverage_end', '')::DATE ELSE NULL END,
        v_receipt_no,
        NULLIF(v_membership->>'note', ''),
        CASE WHEN v_line_idx = 0 THEN COALESCE((v_membership->>'balance_due')::NUMERIC, 0) ELSE 0 END,
        CASE WHEN v_line_idx = 0 AND COALESCE((v_membership->>'balance_due')::NUMERIC, 0) > 0
          THEN NULLIF(v_membership->>'balance_due_date', '')::DATE ELSE NULL END,
        CASE WHEN v_line_idx = 0 THEN v_membership->'package_breakdown' ELSE NULL END,
        v_actor_id
      )
      RETURNING id INTO v_membership_payment_id;
      IF v_first_payment_id IS NULL THEN v_first_payment_id := v_membership_payment_id; END IF;
      v_line_idx := v_line_idx + 1;
    END LOOP;
    v_membership_payment_id := v_first_payment_id;

    INSERT INTO public.activity_logs (user_id, action, entity_type, entity_id, description, metadata)
    VALUES (
      v_actor_id, 'paid_fee', 'member', v_member_id,
      (v_member->>'full_name') || ' paid ' || to_char((v_membership->>'final_amount')::NUMERIC - COALESCE((v_membership->>'balance_due')::NUMERIC,0), 'FM999,999,999') || ' (membership) — ' || v_receipt_no ||
        CASE WHEN COALESCE((v_membership->>'balance_due')::NUMERIC, 0) > 0
          THEN ' — ' || to_char((v_membership->>'balance_due')::NUMERIC, 'FM999,999,999') || ' balance due' ELSE '' END,
      jsonb_build_object(
        'original', COALESCE((v_membership->>'original_amount')::NUMERIC, 0),
        'discount', COALESCE((v_membership->>'discount_amount')::NUMERIC, 0),
        'final', (v_membership->>'final_amount')::NUMERIC,
        'collected', (v_membership->>'final_amount')::NUMERIC - COALESCE((v_membership->>'balance_due')::NUMERIC,0),
        'balanceDue', COALESCE((v_membership->>'balance_due')::NUMERIC, 0),
        'receipt_no', v_receipt_no
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'member_id', v_member_id,
    'membership_no', v_membership_no,
    'admission_payment_id', v_admission_payment_id,
    'membership_payment_id', v_membership_payment_id,
    'replayed', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.register_member_with_payment(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_member_with_payment(JSONB) TO service_role;
