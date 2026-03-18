// ═══════════════════════════════════════════════════════════════════
// VoiceForge AI — Call Calendar Page (Schedule-X)
// Month / Week / Day views with calls + appointments, audio playback,
// call details panel with transcript & AI summary.
// ═══════════════════════════════════════════════════════════════════

'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import { Card, Badge, Spinner, PageHeader } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { formatDuration, formatPhoneNumber, getCallStatusLabels, cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import {
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  Calendar as CalendarIcon,
  Play,
  Pause,
  X,
  Bot,
  MessageSquare,
  Volume2,
  ExternalLink,
  CalendarCheck,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ApiResponse } from '@voiceforge/shared';

// Schedule-X
import { useNextCalendarApp, ScheduleXCalendar } from '@schedule-x/react';
import { createViewMonthGrid, createViewWeek, createViewDay } from '@schedule-x/calendar';
import { createEventsServicePlugin } from '@schedule-x/events-service';
import { createCurrentTimePlugin } from '@schedule-x/current-time';
import { createEventModalPlugin } from '@schedule-x/event-modal';
import 'temporal-polyfill/global';
import '@schedule-x/theme-default/dist/index.css';

// ── Types ────────────────────────────────────────────────────────

interface CalendarCall {
  id: string;
  callerNumber: string;
  agentNumber: string;
  agentName: string;
  direction: 'inbound' | 'outbound';
  status: string;
  durationSeconds: number | null;
  summary: string | null;
  sentiment: number | null;
  appointmentBooked: boolean;
  recordingUrl: string | null;
  transcript: string | null;
  startedAt: string;
  endedAt: string | null;
}

interface CalendarAppointment {
  id: string;
  callerName: string;
  callerPhone: string;
  agentName: string;
  serviceType: string | null;
  scheduledAt: string;
  durationMinutes: number;
  status: string;
  notes: string | null;
  callId: string | null;
  callSummary: string | null;
}

type SelectedEvent =
  | { type: 'call'; data: CalendarCall }
  | { type: 'appointment'; data: CalendarAppointment };

// ── Helpers ──────────────────────────────────────────────────────

const TZ = 'Europe/Athens';

/** Convert ISO string to Temporal.ZonedDateTime for Schedule-X v4 */
function isoToZdt(iso: string): Temporal.ZonedDateTime {
  const inst = Temporal.Instant.from(new Date(iso).toISOString());
  return inst.toZonedDateTimeISO(TZ);
}

/** Add minutes to a ZonedDateTime */
function addMinutes(zdt: Temporal.ZonedDateTime, minutes: number): Temporal.ZonedDateTime {
  return zdt.add({ minutes });
}

/** Module-level: today as Temporal.PlainDate — required by Schedule-X v4 */
const TODAY_PLAIN_DATE = Temporal.Now.plainDateISO();

/** Format time from ISO string */
function formatTime(iso: string, locale: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString(locale === 'el' ? 'el-GR' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ═══════════════════════════════════════════════════════════════════
// Main Page
// ═══════════════════════════════════════════════════════════════════

export default function CalendarPage() {
  const { t, locale } = useI18n();
  const statusLabels = getCallStatusLabels(t);

  const [selectedEvent, setSelectedEvent] = useState<SelectedEvent | null>(null);

  // Audio player state
  const [playingCallId, setPlayingCallId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Refs to store raw data for the detail panel (indexed by event id)
  const callMapRef = useRef<Map<string, CalendarCall>>(new Map());
  const aptMapRef = useRef<Map<string, CalendarAppointment>>(new Map());

  // Events service plugin for dynamic event management
  const eventsServicePlugin = useMemo(() => createEventsServicePlugin(), []);

  // ── Fetch events callback ────────────────────────────────────

  const fetchEvents = useCallback(async (range: { start: Temporal.ZonedDateTime; end: Temporal.ZonedDateTime }) => {
    try {
      // Extract year/month from Temporal.ZonedDateTime range
      const startPlain = range.start.toPlainDate();
      const endPlain = range.end.toPlainDate();

      // Collect all months that overlap this range
      const months: Array<{ year: number; month: number }> = [];
      let cursor = startPlain.toPlainYearMonth();
      const endYm = endPlain.toPlainYearMonth();
      while (Temporal.PlainYearMonth.compare(cursor, endYm) <= 0) {
        months.push({ year: cursor.year, month: cursor.month });
        cursor = cursor.add({ months: 1 });
      }

      // Fetch calls and appointments for all overlapping months
      const results = await Promise.all(
        months.flatMap(({ year, month }) => [
          api.get<ApiResponse<CalendarCall[]>>('/api/calls/calendar/month', { params: { year, month } }),
          api.get<ApiResponse<CalendarAppointment[]>>('/api/calls/calendar/appointments', { params: { year, month } }),
        ]),
      );

      // Separate calls and appointments
      const allCalls: CalendarCall[] = [];
      const allApts: CalendarAppointment[] = [];

      for (let i = 0; i < results.length; i++) {
        const res = results[i];
        if (res?.success && Array.isArray(res.data)) {
          if (i % 2 === 0) {
            allCalls.push(...(res.data as CalendarCall[]));
          } else {
            allApts.push(...(res.data as CalendarAppointment[]));
          }
        }
      }

      // Deduplicate by id (multiple months may overlap)
      const uniqueCalls = [...new Map(allCalls.map(c => [c.id, c])).values()];
      const uniqueApts = [...new Map(allApts.map(a => [a.id, a])).values()];

      // Store in refs for detail panel access
      callMapRef.current = new Map(uniqueCalls.map(c => [c.id, c]));
      aptMapRef.current = new Map(uniqueApts.map(a => [`apt-${a.id}`, a]));

      // Convert to Schedule-X events (Temporal.ZonedDateTime)
      const callEvents = uniqueCalls.map(call => {
        const startZdt = isoToZdt(call.startedAt);
        let endZdt = isoToZdt(call.endedAt ?? call.startedAt);
        // Ensure min 15 min display for very short calls
        if (Temporal.ZonedDateTime.compare(endZdt, addMinutes(startZdt, 15)) < 0) {
          endZdt = addMinutes(startZdt, 15);
        }

        return {
          id: call.id,
          start: startZdt,
          end: endZdt,
          title: `${formatPhoneNumber(call.callerNumber)} · ${call.agentName}`,
          calendarId: call.status === 'completed' ? 'calls-completed'
            : call.status === 'missed' ? 'calls-missed'
            : 'calls-other',
          _type: 'call' as const,
          _callId: call.id,
        };
      });

      const aptEvents = uniqueApts.map(apt => {
        const startZdt = isoToZdt(apt.scheduledAt);
        const endZdt = addMinutes(startZdt, apt.durationMinutes);

        return {
          id: `apt-${apt.id}`,
          start: startZdt,
          end: endZdt,
          title: `📅 ${apt.callerName}`,
          calendarId: apt.status === 'cancelled' ? 'apt-cancelled' : 'appointments',
          _type: 'appointment' as const,
          _aptId: apt.id,
        };
      });

      return [...callEvents, ...aptEvents];
    } catch {
      toast.error(t.calendar.loadError);
      return [];
    }
  }, [t.calendar.loadError]);

  // ── Schedule-X calendar app ──────────────────────────────────

  const calendarApp = useNextCalendarApp({
    locale: locale === 'el' ? 'el-GR' : 'en-US',
    firstDayOfWeek: 1, // Monday
    defaultView: 'month-grid',
    views: [createViewMonthGrid(), createViewWeek(), createViewDay()],
    selectedDate: TODAY_PLAIN_DATE,
    dayBoundaries: { start: '07:00', end: '21:00' },
    weekOptions: { gridHeight: 800, nDays: 5, eventWidth: 95 },
    monthGridOptions: { nEventsPerDay: 4 },
    calendars: {
      'calls-completed': {
        colorName: 'calls-completed',
        label: t.calendar.incoming,
        lightColors: { main: '#16a34a', container: '#f0fdf4', onContainer: '#166534' },
        darkColors: { main: '#22c55e', container: '#052e16', onContainer: '#86efac' },
      },
      'calls-missed': {
        colorName: 'calls-missed',
        label: 'Missed',
        lightColors: { main: '#dc2626', container: '#fef2f2', onContainer: '#991b1b' },
        darkColors: { main: '#ef4444', container: '#450a0a', onContainer: '#fca5a5' },
      },
      'calls-other': {
        colorName: 'calls-other',
        label: 'Other',
        lightColors: { main: '#6b7280', container: '#f9fafb', onContainer: '#374151' },
        darkColors: { main: '#9ca3af', container: '#1f2937', onContainer: '#d1d5db' },
      },
      appointments: {
        colorName: 'appointments',
        label: t.calendar.appointmentsTag,
        lightColors: { main: '#d97706', container: '#fffbeb', onContainer: '#92400e' },
        darkColors: { main: '#f59e0b', container: '#451a03', onContainer: '#fde68a' },
      },
      'apt-cancelled': {
        colorName: 'apt-cancelled',
        label: t.calendar.appointmentCancelled,
        lightColors: { main: '#9ca3af', container: '#f3f4f6', onContainer: '#6b7280' },
        darkColors: { main: '#6b7280', container: '#1f2937', onContainer: '#9ca3af' },
      },
    },
    callbacks: {
      fetchEvents,
      onEventClick(event) {
        const evtType = (event as any)._type;
        if (evtType === 'call') {
          const call = callMapRef.current.get(event.id as string);
          if (call) setSelectedEvent({ type: 'call', data: call });
        } else if (evtType === 'appointment') {
          const apt = aptMapRef.current.get(event.id as string);
          if (apt) setSelectedEvent({ type: 'appointment', data: apt });
        }
      },
    },
    translations: {
      'el-GR': {
        Today: 'Σήμερα',
        Month: 'Μήνας',
        Week: 'Εβδομάδα',
        Day: 'Ημέρα',
        'Select View': 'Προβολή',
        View: 'Προβολή',
        '+ {{n}} events': '+ {{n}} γεγονότα',
        '+ 1 event': '+ 1 γεγονός',
        'No events': 'Κανένα γεγονός',
        'Next period': 'Επόμενο',
        'Previous period': 'Προηγούμενο',
        to: 'έως',
        'Full day- and multiple day events': 'Ολοήμερα γεγονότα',
        'Link to {{n}} more events on {{date}}': '+ {{n}} γεγονότα στις {{date}}',
        'Link to 1 more event on {{date}}': '+ 1 γεγονός στις {{date}}',
        CW: 'Εβδ.',
      },
    },
  }, [createEventsServicePlugin(), createCurrentTimePlugin(), createEventModalPlugin()]);

  // ── Audio player ─────────────────────────────────────────────

  const handlePlay = (callId: string, url: string) => {
    if (playingCallId === callId) {
      if (audioRef.current) {
        if (audioRef.current.paused) audioRef.current.play();
        else audioRef.current.pause();
      }
      return;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    const audio = new Audio(url);
    audio.onended = () => setPlayingCallId(null);
    audio.onerror = () => { setPlayingCallId(null); toast.error(t.calendar.noRecording); };
    audio.play();
    audioRef.current = audio;
    setPlayingCallId(callId);
  };

  const stopPlaying = () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setPlayingCallId(null);
  };

  useEffect(() => {
    return () => { if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; } };
  }, []);

  // ── Delete appointment handler ───────────────────────────────

  const handleDeleteAppointment = async (aptId: string) => {
    if (!confirm(t.calendar.deleteAppointmentConfirm)) return;
    try {
      const res = await api.delete<ApiResponse>(`/api/calls/calendar/appointments/${aptId}`);
      if (res.success) {
        toast.success(t.calendar.appointmentDeleted);
        // Remove from calendar
        if (calendarApp) {
          calendarApp.events.remove(`apt-${aptId}`);
        }
        aptMapRef.current.delete(`apt-${aptId}`);
        setSelectedEvent(null);
      } else {
        toast.error(res.error?.message ?? 'Error');
      }
    } catch { toast.error('Error'); }
  };

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════

  return (
    <div>
      <PageHeader
        title={t.calendar.title}
        description={t.calendar.description}
      />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* ── Schedule-X Calendar ───────────────────────────────── */}
        <div className="xl:col-span-2">
          <Card padding="none" className="overflow-hidden">
            <div className="sx-calendar-wrapper">
              {calendarApp ? (
                <ScheduleXCalendar calendarApp={calendarApp} />
              ) : (
                <div className="flex items-center justify-center h-[600px]">
                  <Spinner size="lg" />
                </div>
              )}
            </div>
          </Card>

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-4 mt-3 px-1">
            <div className="flex items-center gap-1.5 text-xs text-text-secondary">
              <span className="w-3 h-3 rounded-sm bg-success-500" />
              {t.calendar.incoming} ({locale === 'el' ? 'ολοκληρωμένη' : 'completed'})
            </div>
            <div className="flex items-center gap-1.5 text-xs text-text-secondary">
              <span className="w-3 h-3 rounded-sm bg-danger-500" />
              {locale === 'el' ? 'Αναπάντητη' : 'Missed'}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-text-secondary">
              <span className="w-3 h-3 rounded-sm bg-amber-500" />
              {t.calendar.appointmentsTag}
            </div>
          </div>
        </div>

        {/* ── Event Detail Panel ────────────────────────────────── */}
        <div className="xl:col-span-1">
          <Card padding="none" className="sticky top-6">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <h3 className="text-base font-semibold text-text-primary">
                {selectedEvent
                  ? selectedEvent.type === 'call'
                    ? `${t.calendar.incoming} · ${formatTime(selectedEvent.data.startedAt, locale)}`
                    : `${t.calendar.appointmentsTag} · ${formatTime(selectedEvent.data.scheduledAt, locale)}`
                  : t.calendar.title}
              </h3>
              {selectedEvent && (
                <button
                  onClick={() => { setSelectedEvent(null); stopPlaying(); }}
                  className="p-1.5 rounded-md hover:bg-surface-tertiary text-text-tertiary"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
              {!selectedEvent ? (
                <div className="py-16 text-center">
                  <CalendarIcon className="w-10 h-10 text-text-tertiary mx-auto mb-3" />
                  <p className="text-sm text-text-tertiary">
                    {locale === 'el' ? 'Κλικ σε ένα γεγονός για λεπτομέρειες' : 'Click an event for details'}
                  </p>
                </div>
              ) : selectedEvent.type === 'appointment' ? (
                <AppointmentDetail
                  apt={selectedEvent.data}
                  locale={locale}
                  t={t}
                  onDelete={handleDeleteAppointment}
                />
              ) : (
                <CallDetail
                  call={selectedEvent.data}
                  locale={locale}
                  t={t}
                  statusLabels={statusLabels}
                  playingCallId={playingCallId}
                  onPlay={handlePlay}
                  onStopPlaying={stopPlaying}
                />
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Appointment Detail Sub-Component
// ═══════════════════════════════════════════════════════════════════

function AppointmentDetail({
  apt,
  locale,
  t,
  onDelete,
}: {
  apt: CalendarAppointment;
  locale: string;
  t: any;
  onDelete: (id: string) => void;
}) {
  const aptStatusLabel = {
    pending: t.calendar.appointmentPending,
    confirmed: t.calendar.appointmentConfirmed,
    cancelled: t.calendar.appointmentCancelled,
    completed: t.calendar.appointmentCompleted,
    no_show: t.calendar.appointmentNoShow,
  }[apt.status] ?? apt.status;

  return (
    <div className="px-5 py-4 space-y-4 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
          <CalendarCheck className="w-5 h-5 text-amber-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-text-primary truncate">{apt.callerName}</p>
          <p className="text-xs text-text-tertiary font-mono">{formatPhoneNumber(apt.callerPhone)}</p>
        </div>
        <Badge variant={apt.status === 'confirmed' ? 'success' : apt.status === 'cancelled' ? 'danger' : 'default'}>
          {aptStatusLabel}
        </Badge>
      </div>

      {/* Details grid */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <span className="text-text-tertiary">{t.calendar.appointmentTime}</span>
          <p className="text-text-primary font-medium mt-0.5">
            {formatTime(apt.scheduledAt, locale)} · {apt.durationMinutes}{locale === 'el' ? 'λ' : 'min'}
          </p>
        </div>
        <div>
          <span className="text-text-tertiary">{t.calendar.agent}</span>
          <p className="text-text-primary mt-0.5">{apt.agentName}</p>
        </div>
        {apt.serviceType && (
          <div className="col-span-2">
            <span className="text-text-tertiary">{locale === 'el' ? 'Υπηρεσία' : 'Service'}</span>
            <p className="text-text-primary mt-0.5">{apt.serviceType}</p>
          </div>
        )}
      </div>

      {/* Notes */}
      {apt.notes && (
        <div>
          <span className="text-[11px] font-medium text-text-tertiary">{t.calendar.appointmentNotes}</span>
          <p className="text-xs text-text-secondary mt-1 leading-relaxed">{apt.notes}</p>
        </div>
      )}

      {/* Call summary if linked */}
      {apt.callSummary && (
        <div>
          <div className="flex items-center gap-1 mb-1">
            <Bot className="w-3 h-3 text-brand-500" />
            <span className="text-[11px] font-medium text-text-tertiary">{t.calendar.summary}</span>
          </div>
          <p className="text-xs text-text-secondary leading-relaxed">{apt.callSummary}</p>
        </div>
      )}

      {/* Delete button */}
      <button
        onClick={() => onDelete(apt.id)}
        className="flex items-center gap-1.5 text-xs text-red-600 hover:text-red-700 font-medium mt-2"
      >
        <Trash2 className="w-3.5 h-3.5" />
        {t.calendar.deleteAppointment}
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Call Detail Sub-Component
// ═══════════════════════════════════════════════════════════════════

function CallDetail({
  call,
  locale,
  t,
  statusLabels,
  playingCallId,
  onPlay,
  onStopPlaying,
}: {
  call: CalendarCall;
  locale: string;
  t: any;
  statusLabels: Record<string, { label: string; color: string }>;
  playingCallId: string | null;
  onPlay: (callId: string, url: string) => void;
  onStopPlaying: () => void;
}) {
  const isPlaying = playingCallId === call.id;
  const statusInfo = statusLabels[call.status] ?? { label: call.status, color: '' };

  return (
    <div className="px-5 py-4 space-y-4 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className={cn(
          'w-10 h-10 rounded-full flex items-center justify-center shrink-0',
          call.status === 'completed' ? 'bg-success-50' : call.status === 'missed' ? 'bg-danger-50' : 'bg-surface-tertiary',
        )}>
          {call.direction === 'inbound' ? (
            <PhoneIncoming className={cn('w-5 h-5', call.status === 'completed' ? 'text-success-600' : 'text-danger-600')} />
          ) : (
            <PhoneOutgoing className="w-5 h-5 text-text-tertiary" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-text-primary truncate">
            {formatPhoneNumber(call.callerNumber)}
          </p>
          <p className="text-xs text-text-tertiary">{call.agentName}</p>
        </div>
        <Badge variant={call.status === 'completed' ? 'success' : call.status === 'missed' ? 'danger' : 'default'}>
          {statusInfo.label}
        </Badge>
      </div>

      {/* Details grid */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <span className="text-text-tertiary">{t.calendar.duration}</span>
          <p className="text-text-primary font-medium mt-0.5">
            {call.durationSeconds != null ? formatDuration(call.durationSeconds) : '—'}
          </p>
        </div>
        <div>
          <span className="text-text-tertiary">{call.direction === 'inbound' ? t.calendar.incoming : t.calendar.outgoing}</span>
          <p className="text-text-primary font-mono text-[11px] mt-0.5">
            {formatTime(call.startedAt, locale)}
          </p>
        </div>
      </div>

      {/* Audio player */}
      {call.recordingUrl ? (
        <div className={cn(
          'flex items-center gap-2 p-2.5 rounded-lg border transition-colors',
          isPlaying ? 'bg-brand-50 border-brand-200' : 'bg-surface-secondary border-border',
        )}>
          <button
            onClick={() => onPlay(call.id, call.recordingUrl!)}
            className={cn(
              'w-8 h-8 rounded-full flex items-center justify-center transition-colors shrink-0',
              isPlaying ? 'bg-brand-600 text-white hover:bg-brand-700' : 'bg-brand-100 text-brand-600 hover:bg-brand-200',
            )}
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
          </button>
          <div className="flex-1 min-w-0">
            <span className="text-xs font-medium text-text-primary">
              {isPlaying ? t.calendar.playing : t.calendar.listenRecording}
            </span>
            {call.durationSeconds != null && (
              <span className="text-[10px] text-text-tertiary ml-2">{formatDuration(call.durationSeconds)}</span>
            )}
          </div>
          {isPlaying && (
            <button onClick={onStopPlaying} className="p-1 rounded hover:bg-brand-100 text-text-tertiary">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-surface-secondary border border-border text-text-tertiary">
          <Volume2 className="w-4 h-4 opacity-40" />
          <span className="text-xs">{t.calendar.noRecording}</span>
        </div>
      )}

      {/* AI Summary */}
      {call.summary && (
        <div>
          <div className="flex items-center gap-1 mb-1">
            <Bot className="w-3 h-3 text-brand-500" />
            <span className="text-[11px] font-medium text-text-tertiary">{t.calendar.summary}</span>
          </div>
          <p className="text-xs text-text-secondary leading-relaxed">{call.summary}</p>
        </div>
      )}

      {/* Transcript preview */}
      {call.transcript && (
        <div>
          <div className="flex items-center gap-1 mb-1">
            <MessageSquare className="w-3 h-3 text-brand-500" />
            <span className="text-[11px] font-medium text-text-tertiary">{t.calendar.transcript}</span>
          </div>
          <div className="bg-surface-tertiary rounded-lg p-2.5 max-h-32 overflow-y-auto">
            <pre className="text-[11px] text-text-secondary whitespace-pre-wrap font-sans leading-relaxed">
              {call.transcript.length > 500 ? `${call.transcript.slice(0, 500)}...` : call.transcript}
            </pre>
          </div>
        </div>
      )}

      {/* Sentiment */}
      {call.sentiment != null && (
        <div className="flex items-center gap-2">
          <span className="text-lg">{call.sentiment >= 4 ? '😊' : call.sentiment <= 2 ? '😞' : '😐'}</span>
          <span className="text-xs text-text-tertiary">{call.sentiment}/5</span>
        </div>
      )}

      {/* Appointment badge */}
      {call.appointmentBooked && (
        <Badge variant="success">
          <CalendarCheck className="w-3 h-3 mr-1" />
          {t.calendar.appointmentIcon}
        </Badge>
      )}

      {/* Link to full detail */}
      <Link
        href={`/dashboard/calls/${call.id}`}
        className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-medium"
      >
        <ExternalLink className="w-3 h-3" />
        {t.calendar.viewDetails}
      </Link>
    </div>
  );
}