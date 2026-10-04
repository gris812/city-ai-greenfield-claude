-- Cross-session journey memory for returning users/guests (D-023, D-012).
-- One row per (owner, place): when the place was last told as a story or follow-up. Place ids
-- only — no coordinates, no names, no text. owner_id is the user id or guest id (sessions.user_id
-- ?? sessions.guest_id). Retention: 90 days after last_told_at (run_retention), and deleted with
-- the account/guest by DELETE /v1/me.

CREATE TABLE place_history (
  owner_id      uuid NOT NULL,
  place_id      text NOT NULL,
  last_told_at  timestamptz NOT NULL,
  times         int NOT NULL DEFAULT 1,
  PRIMARY KEY (owner_id, place_id)
);
CREATE INDEX place_history_owner_idx ON place_history(owner_id, last_told_at DESC);
CREATE INDEX place_history_told_idx ON place_history(last_told_at);

CREATE OR REPLACE FUNCTION run_retention() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  n_events bigint; n_lat bigint; n_cost bigint; n_audit bigint; n_mem bigint; n_codes bigint; n_hist bigint;
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
  DELETE FROM place_history WHERE last_told_at < now() - interval '90 days';
  GET DIAGNOSTICS n_hist = ROW_COUNT;
  DELETE FROM otp_codes WHERE expires_at < now() - interval '1 day';
  DELETE FROM pairing_codes WHERE expires_at < now() - interval '1 day';
  GET DIAGNOSTICS n_codes = ROW_COUNT;
  RETURN jsonb_build_object('events', n_events, 'latency_samples', n_lat, 'cost_ledger', n_cost, 'audit_log', n_audit, 'journey_memory', n_mem, 'place_history', n_hist, 'codes', n_codes);
END $$;
