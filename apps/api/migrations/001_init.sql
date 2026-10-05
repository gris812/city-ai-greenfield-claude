-- Telvey initial schema (D-011, D-012, D-013, D-014).
-- Privacy: no table stores precise coordinates. Location appears only as geohash-5 (≈5 km).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE TABLE guests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX guests_user_idx ON guests(user_id);

CREATE TABLE otp_codes (
  id          bigserial PRIMARY KEY,
  email       text NOT NULL,
  code_hash   text NOT NULL,
  guest_id    uuid,
  attempts    int NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_codes_email_idx ON otp_codes(email, created_at DESC);

CREATE TABLE admin_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  role          text NOT NULL CHECK (role IN ('owner', 'admin', 'analyst')),
  display_name  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  disabled_at   timestamptz
);

-- One-time codes: bootstrap (CLI, owner) and invites (issued by an owner).
CREATE TABLE admin_invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('bootstrap', 'invite')),
  email       text NOT NULL,
  role        text NOT NULL CHECK (role IN ('owner', 'admin', 'analyst')),
  code_hash   text NOT NULL,
  created_by  uuid REFERENCES admin_users(id),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE webauthn_credentials (
  id             text PRIMARY KEY,               -- credential id (base64url)
  admin_user_id  uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  public_key     bytea NOT NULL,
  counter        bigint NOT NULL DEFAULT 0,
  transports     text[] NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_used_at   timestamptz
);

CREATE TABLE admin_devices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id  uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  name           text NOT NULL,
  role           text NOT NULL CHECK (role IN ('owner', 'admin', 'analyst')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz,
  revoked_at     timestamptz
);

CREATE TABLE pairing_codes (
  code_hash      text PRIMARY KEY,
  admin_user_id  uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  role           text NOT NULL,
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz
);

CREATE TABLE sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id        uuid REFERENCES guests(id) ON DELETE CASCADE,
  user_id         uuid REFERENCES users(id) ON DELETE CASCADE,
  guide_id        text NOT NULL,
  locale          text NOT NULL,
  units           text NOT NULL,
  simulated       boolean NOT NULL DEFAULT false,
  platform        text,
  app_version     text,
  policy_version  text NOT NULL,
  start_geohash5  text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz,
  duration_s      int,
  stories         int NOT NULL DEFAULT 0,
  cost_usd        numeric(12, 6) NOT NULL DEFAULT 0
);
CREATE INDEX sessions_started_idx ON sessions(started_at);
CREATE INDEX sessions_guest_idx ON sessions(guest_id);
CREATE INDEX sessions_user_idx ON sessions(user_id);

-- Journey memory: place ids/names/angles only — no coordinates.
CREATE TABLE journey_memory (
  session_id  uuid PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  owner_id    uuid NOT NULL,
  memory      jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX journey_memory_owner_idx ON journey_memory(owner_id, updated_at DESC);

CREATE TABLE stories (
  id               text PRIMARY KEY,           -- NarrativePlan id
  session_id       uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  place_id         text NOT NULL,
  place_name       text NOT NULL,
  place_kind       text NOT NULL,
  angle            text,
  mode             text,
  guide_id         text NOT NULL,
  locale           text NOT NULL,
  regime           text,
  geohash5         text,
  generated_by     text NOT NULL,              -- 'llm' | 'template'
  provider         text,
  model            text,
  grounding_ok     boolean NOT NULL,
  fallback_reason  text,
  segments         int NOT NULL,
  words            int NOT NULL,
  status           text NOT NULL DEFAULT 'playing',
  created_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz
);
CREATE INDEX stories_session_idx ON stories(session_id);
CREATE INDEX stories_created_idx ON stories(created_at);

CREATE TABLE events (
  id          bigserial PRIMARY KEY,
  name        text NOT NULL,
  session_id  uuid,
  at          timestamptz NOT NULL,
  geohash5    text CHECK (geohash5 IS NULL OR length(geohash5) <= 5),
  regime      text,
  props       jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX events_at_idx ON events(at);
CREATE INDEX events_name_at_idx ON events(name, at);
CREATE INDEX events_session_idx ON events(session_id);

CREATE TABLE cost_ledger (
  id          bigserial PRIMARY KEY,
  session_id  uuid,
  provider    text NOT NULL,
  model       text,
  category    text NOT NULL,
  task        text NOT NULL,
  units       jsonb NOT NULL DEFAULT '{}',
  cost_usd    numeric(14, 8) NOT NULL DEFAULT 0,
  latency_ms  int NOT NULL DEFAULT 0,
  cache_hit   boolean NOT NULL DEFAULT false,
  ok          boolean NOT NULL DEFAULT true,
  at          timestamptz NOT NULL
);
CREATE INDEX cost_ledger_at_idx ON cost_ledger(at);
CREATE INDEX cost_ledger_session_idx ON cost_ledger(session_id);

CREATE TABLE latency_samples (
  id           bigserial PRIMARY KEY,
  session_id   uuid,
  interaction  text NOT NULL,
  ms           double precision NOT NULL,
  props        jsonb NOT NULL DEFAULT '{}',
  at           timestamptz NOT NULL
);
CREATE INDEX latency_samples_idx ON latency_samples(interaction, at);

CREATE TABLE feedback (
  id          bigserial PRIMARY KEY,
  session_id  uuid REFERENCES sessions(id) ON DELETE CASCADE,
  plan_id     text,
  rating      smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Append-only audit log: UPDATE/DELETE are rejected except by the retention job.
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  actor_id    uuid,
  actor_role  text,
  action      text NOT NULL,
  target      text,
  details     jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_log_at_idx ON audit_log(at);

CREATE FUNCTION audit_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.retention', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_log is append-only';
END $$;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

CREATE TABLE provider_budgets (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  limits      jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid
);
