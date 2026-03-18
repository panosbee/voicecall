// ═══════════════════════════════════════════════════════════════════
// VoiceForge AI — Business Hours Helper
// Generates appointment slots from per-agent BusinessHoursConfig
// Replaces all hardcoded BUSINESS_SLOTS arrays
// ═══════════════════════════════════════════════════════════════════

import type { BusinessHoursConfig, DaySchedule } from '@voiceforge/shared';
import { DEFAULT_BUSINESS_HOURS } from '@voiceforge/shared';

/**
 * Parse a BusinessHoursConfig from JSONB (handles empty object / legacy agents).
 * Returns the config with all defaults filled in.
 */
export function parseBusinessHours(raw: unknown): BusinessHoursConfig {
  if (!raw || typeof raw !== 'object' || Object.keys(raw as object).length === 0) {
    return DEFAULT_BUSINESS_HOURS;
  }
  const config = raw as Partial<BusinessHoursConfig>;
  return {
    weeklySchedule: config.weeklySchedule ?? DEFAULT_BUSINESS_HOURS.weeklySchedule,
    slotDurationMinutes: config.slotDurationMinutes ?? DEFAULT_BUSINESS_HOURS.slotDurationMinutes,
    closedDates: config.closedDates ?? DEFAULT_BUSINESS_HOURS.closedDates,
    timezone: config.timezone,
  };
}

/**
 * Get the DaySchedule for a given date.
 * Returns { enabled: false } if the date is in closedDates.
 */
export function getDaySchedule(config: BusinessHoursConfig, dateStr: string): DaySchedule {
  // Check closedDates first
  if (config.closedDates.includes(dateStr)) {
    return { enabled: false, timeRanges: [] };
  }

  const date = new Date(dateStr + 'T12:00:00');
  const dayOfWeek = date.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const schedule = config.weeklySchedule[String(dayOfWeek)];

  if (!schedule) {
    return { enabled: false, timeRanges: [] };
  }

  return schedule;
}

/**
 * Generate all appointment slot times for a given date.
 * Returns an array of HH:MM strings based on the agent's business hours config.
 */
export function generateSlots(config: BusinessHoursConfig, dateStr: string): string[] {
  const daySchedule = getDaySchedule(config, dateStr);

  if (!daySchedule.enabled || daySchedule.timeRanges.length === 0) {
    return [];
  }

  const slotDuration = config.slotDurationMinutes || 30;
  const slots: string[] = [];

  for (const range of daySchedule.timeRanges) {
    const [startH, startM] = range.start.split(':').map(Number);
    const [endH, endM] = range.end.split(':').map(Number);
    const startMinutes = (startH ?? 0) * 60 + (startM ?? 0);
    const endMinutes = (endH ?? 0) * 60 + (endM ?? 0);

    for (let mins = startMinutes; mins < endMinutes; mins += slotDuration) {
      const h = Math.floor(mins / 60).toString().padStart(2, '0');
      const m = (mins % 60).toString().padStart(2, '0');
      slots.push(`${h}:${m}`);
    }
  }

  return slots;
}

/**
 * Check if a specific date is a working day for this agent.
 */
export function isWorkingDay(config: BusinessHoursConfig, dateStr: string): boolean {
  const schedule = getDaySchedule(config, dateStr);
  return schedule.enabled;
}

/**
 * Format business hours for display (used by get_business_hours tool).
 * Returns a human-readable object with day names.
 */
export function formatBusinessHoursForDisplay(config: BusinessHoursConfig): Record<string, string> {
  const dayNames: Record<string, string> = {
    '1': 'monday', '2': 'tuesday', '3': 'wednesday',
    '4': 'thursday', '5': 'friday', '6': 'saturday', '0': 'sunday',
  };

  const result: Record<string, string> = {};

  for (const [dayNum, dayName] of Object.entries(dayNames)) {
    const schedule = config.weeklySchedule[dayNum];
    if (!schedule || !schedule.enabled || schedule.timeRanges.length === 0) {
      result[dayName] = 'Κλειστά';
    } else {
      result[dayName] = schedule.timeRanges
        .map((r) => `${r.start}-${r.end}`)
        .join(', ');
    }
  }

  return result;
}

/**
 * Get a summary string for business hours (for agent responses).
 */
export function getBusinessHoursSummary(config: BusinessHoursConfig): string {
  const schedule = config.weeklySchedule;
  const workDays: string[] = [];
  const dayLabels: Record<string, string> = {
    '1': 'Δευ', '2': 'Τρι', '3': 'Τετ', '4': 'Πεμ', '5': 'Παρ', '6': 'Σαβ', '0': 'Κυρ',
  };

  for (const dayNum of ['1', '2', '3', '4', '5', '6', '0']) {
    const day = schedule[dayNum];
    if (day?.enabled) {
      workDays.push(dayLabels[dayNum]!);
    }
  }

  // Get time ranges from first enabled day (assumes they're the same)
  const firstEnabledDay = Object.values(schedule).find((d) => d.enabled);
  const timeStr = firstEnabledDay
    ? firstEnabledDay.timeRanges.map((r) => `${r.start}-${r.end}`).join(', ')
    : '';

  return `${workDays.join('-')} ${timeStr}, slots ${config.slotDurationMinutes}λ`;
}
