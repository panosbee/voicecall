-- ═══════════════════════════════════════════════════════════════════
-- Migration: Add iCal calendar integration
-- Adds ical_feed_url to customers + ical_cached_events table
-- ═══════════════════════════════════════════════════════════════════

-- Add iCal URL + last sync timestamp to customers
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS ical_feed_url TEXT,
  ADD COLUMN IF NOT EXISTS ical_last_synced_at TIMESTAMPTZ;

-- Create iCal cached events table
CREATE TABLE IF NOT EXISTS ical_cached_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  uid TEXT NOT NULL,
  summary TEXT,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_ical_events_customer ON ical_cached_events(customer_id);
CREATE INDEX IF NOT EXISTS idx_ical_events_start ON ical_cached_events(start_at);
CREATE INDEX IF NOT EXISTS idx_ical_events_customer_uid ON ical_cached_events(customer_id, uid);
