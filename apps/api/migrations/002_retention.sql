-- Retention (D-012): events 13 months, latency samples 13 months, cost ledger 25 months,
-- audit log 25 months, guest journey memory 90 days after last update, spent OTP/pairing
-- codes after 1 day. Run daily: `pnpm --filter @city/api retention` (or SELECT run_retention()).

CREATE OR REPLACE FUNCTION run_retention() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  n_events bigint; n_lat bigint; n_cost bigint; n_audit bigint; n_mem bigint; n_codes bigint;
BEGIN
  DELETE FROM events WHERE at < now() - interval '13 months';
  GET DIAGNOSTICS n_events = ROW_COUNT;
  DELETE FROM latency_samples WHERE at < now() - interval '13 months';
  GET DIAGNOSTICS n_lat = ROW_COUNT;
  DELETE FROM cost_ledger WHERE at < now() - interval '25 months';
  GET DIAGNOSTICS n_cost = ROW_COUNT;
  PERFORM set_config('app.retention', 'on', true);
  DELETE FROM audit_log WHERE at < now() - interval '25 months';
  GET DIAGNOSTICS n_audit = ROW_COUNT;
  PERFORM set_config('app.retention', 'off', true);
  DELETE FROM journey_memory jm
   USING sessions s
   WHERE jm.session_id = s.id AND s.user_id IS NULL AND jm.updated_at < now() - interval '90 days';
  GET DIAGNOSTICS n_mem = ROW_COUNT;
  DELETE FROM otp_codes WHERE expires_at < now() - interval '1 day';
  DELETE FROM pairing_codes WHERE expires_at < now() - interval '1 day';
  GET DIAGNOSTICS n_codes = ROW_COUNT;
  RETURN jsonb_build_object('events', n_events, 'latency_samples', n_lat, 'cost_ledger', n_cost, 'audit_log', n_audit, 'journey_memory', n_mem, 'codes', n_codes);
END $$;
