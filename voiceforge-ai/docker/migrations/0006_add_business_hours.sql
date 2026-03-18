-- ═══════════════════════════════════════════════════════════════════
-- Migration 0006: Add business_hours JSONB column to agents
-- Per-agent configurable business hours, slot durations, closed dates
-- Replaces hardcoded BUSINESS_SLOTS in server tools
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS business_hours JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN agents.business_hours IS 'Per-agent BusinessHoursConfig: weeklySchedule, slotDurationMinutes, closedDates. Empty {} = use defaults (Mon-Fri 09:00-12:30, 14:00-17:00, 30min slots).';
