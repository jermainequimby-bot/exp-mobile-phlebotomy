-- EXP booking database
-- Run this entire file once in the Neon SQL Editor.

CREATE TABLE IF NOT EXISTS availability_rules (
  id BIGSERIAL PRIMARY KEY,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  slot_minutes SMALLINT NOT NULL DEFAULT 45 CHECK (slot_minutes BETWEEN 15 AND 120),
  service_type TEXT NOT NULL DEFAULT 'standard'
    CHECK (service_type IN ('standard', 'after')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (day_of_week, start_time, end_time, service_type)
);

CREATE TABLE IF NOT EXISTS availability_overrides (
  id BIGSERIAL PRIMARY KEY,
  override_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('block', 'open')),
  service_type TEXT NOT NULL DEFAULT 'standard'
    CHECK (service_type IN ('standard', 'after')),
  note TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS appointments (
  id BIGSERIAL PRIMARY KEY,
  appointment_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  service TEXT NOT NULL CHECK (service IN ('local', 'standard', 'fast', 'after')),
  service_label TEXT NOT NULL,
  service_address TEXT NOT NULL,
  miles NUMERIC(6,1) NOT NULL,
  base_price NUMERIC(10,2) NOT NULL,
  travel_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  total NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'held'
    CHECK (status IN ('held', 'paid', 'cancelled', 'expired', 'conflict')),
  hold_expires_at TIMESTAMPTZ,
  stripe_session_id TEXT,
  stripe_payment_intent_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (appointment_date, start_time)
);

CREATE INDEX IF NOT EXISTS appointments_date_idx
  ON appointments (appointment_date);

CREATE INDEX IF NOT EXISTS appointments_status_idx
  ON appointments (status);

CREATE INDEX IF NOT EXISTS appointments_stripe_session_idx
  ON appointments (stripe_session_id);

-- EXP is currently weekend-only.
-- ISO weekday: 6 = Saturday, 7 = Sunday.
-- Standard booking window: 8:30 AM through 6:00 PM.
-- This produces 45-minute starts from 8:30 AM through 5:15 PM.
INSERT INTO availability_rules
  (day_of_week, start_time, end_time, slot_minutes, service_type)
VALUES
  (6, '08:30', '18:00', 45, 'standard'),
  (7, '08:30', '18:00', 45, 'standard')
ON CONFLICT (day_of_week, start_time, end_time, service_type) DO NOTHING;

-- After-hours rules are intentionally not seeded yet.
-- We will activate them after the exact after-hours window is confirmed.
