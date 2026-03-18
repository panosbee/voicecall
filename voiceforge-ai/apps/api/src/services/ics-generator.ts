// ═══════════════════════════════════════════════════════════════════
// VoiceForge AI — ICS Invite Generator
// Generates .ics (iCalendar) files for appointment email invites
// Recipients can accept the invite in any calendar app (Google/Outlook/Apple)
// ═══════════════════════════════════════════════════════════════════

import { randomUUID } from 'node:crypto';

// ── Types ────────────────────────────────────────────────────────

export interface IcsEventParams {
  summary: string;            // Event title (e.g., "Ραντεβού — Δικηγορικό Γραφείο Παπαδόπουλος")
  description?: string;       // Event description / notes
  startAt: Date;              // Start datetime (UTC)
  endAt: Date;                // End datetime (UTC)
  location?: string;          // Physical or virtual location
  organizerName: string;      // Business name
  organizerEmail: string;     // Business email (FROM)
  attendeeName?: string;      // Client name
  attendeeEmail?: string;     // Client email (optional — only if known)
}

// ── ICS Generation ───────────────────────────────────────────────

/**
 * Format a Date to iCal DATETIME format: YYYYMMDDTHHmmSSZ
 */
function formatIcalDateTime(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Escape text for iCal property values per RFC 5545.
 */
function escapeIcalText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * Generate a complete .ics file content string for an appointment invite.
 * The output follows RFC 5545 and uses METHOD:REQUEST so calendar apps
 * present an accept/decline dialog.
 */
export function generateIcsInvite(params: IcsEventParams): string {
  const uid = `${randomUUID()}@voiceforge.ai`;
  const now = formatIcalDateTime(new Date());
  const dtStart = formatIcalDateTime(params.startAt);
  const dtEnd = formatIcalDateTime(params.endAt);

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//VoiceForge AI//Appointment//EL',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeIcalText(params.summary)}`,
    `ORGANIZER;CN=${escapeIcalText(params.organizerName)}:mailto:${params.organizerEmail}`,
  ];

  if (params.description) {
    lines.push(`DESCRIPTION:${escapeIcalText(params.description)}`);
  }

  if (params.location) {
    lines.push(`LOCATION:${escapeIcalText(params.location)}`);
  }

  if (params.attendeeEmail) {
    const cn = params.attendeeName ? `;CN=${escapeIcalText(params.attendeeName)}` : '';
    lines.push(
      `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE${cn}:mailto:${params.attendeeEmail}`,
    );
  }

  // Set reminder: 30 minutes before
  lines.push(
    'BEGIN:VALARM',
    'TRIGGER:-PT30M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeIcalText(params.summary)}`,
    'END:VALARM',
  );

  lines.push('END:VEVENT', 'END:VCALENDAR');

  // iCal requires CRLF line endings
  return lines.join('\r\n') + '\r\n';
}

/**
 * Generate an ICS cancellation for an existing event.
 * Sends METHOD:CANCEL so calendar apps remove the event.
 */
export function generateIcsCancellation(params: {
  originalUid: string;
  summary: string;
  startAt: Date;
  endAt: Date;
  organizerName: string;
  organizerEmail: string;
}): string {
  const now = formatIcalDateTime(new Date());
  const dtStart = formatIcalDateTime(params.startAt);
  const dtEnd = formatIcalDateTime(params.endAt);

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//VoiceForge AI//Appointment//EL',
    'CALSCALE:GREGORIAN',
    'METHOD:CANCEL',
    'BEGIN:VEVENT',
    `UID:${params.originalUid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeIcalText('ΑΚΥΡΩΘΗΚΕ: ' + params.summary)}`,
    `ORGANIZER;CN=${escapeIcalText(params.organizerName)}:mailto:${params.organizerEmail}`,
    'STATUS:CANCELLED',
    'SEQUENCE:1',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.join('\r\n') + '\r\n';
}
