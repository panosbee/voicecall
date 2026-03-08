-- ═══════════════════════════════════════════════════════════════════
-- Migration 0004: Add widget embed configuration to agents
-- Allows agents to be embedded on customer websites
-- ═══════════════════════════════════════════════════════════════════

-- Widget enabled flag
ALTER TABLE agents ADD COLUMN IF NOT EXISTS widget_enabled BOOLEAN NOT NULL DEFAULT false;

-- Widget appearance
ALTER TABLE agents ADD COLUMN IF NOT EXISTS widget_color TEXT NOT NULL DEFAULT '#6366f1';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS widget_position TEXT NOT NULL DEFAULT 'bottom-right';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS widget_button_text TEXT NOT NULL DEFAULT 'Talk to us';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS widget_icon_type TEXT NOT NULL DEFAULT 'phone';

-- Widget allowed origins (empty = allow all)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS widget_allowed_origins JSONB NOT NULL DEFAULT '[]';
