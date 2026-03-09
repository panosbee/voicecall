// ═══════════════════════════════════════════════════════════════════
// VoiceForge AI — Calls / Dashboard Routes
// Call history, analytics, individual call details
// ═══════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and, gte, lte, desc, sql, count } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { customers, calls, agents, appointments } from '../db/schema/index.js';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { createLogger } from '../config/logger.js';
import { getMonthRangeInTimezone } from '../services/timezone.js';
import type { ApiResponse } from '@voiceforge/shared';

const log = createLogger('calls');

export const callRoutes = new Hono<{ Variables: { user: AuthUser } }>();

callRoutes.use('*', authMiddleware);

// ── Validation ───────────────────────────────────────────────────

const listCallsSchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  agentId: z.string().uuid().optional(),
  from: z.string().optional(), // ISO date
  to: z.string().optional(), // ISO date
});

// ═══════════════════════════════════════════════════════════════════
// GET /calls — List calls with filtering & pagination
// ═══════════════════════════════════════════════════════════════════

callRoutes.get('/', zValidator('query', listCallsSchema), async (c) => {
  const user = c.get('user');
  const query = c.req.valid('query');

  const customer = await db.query.customers.findFirst({
    where: eq(customers.userId, user.sub),
  });

  if (!customer) {
    return c.json<ApiResponse>({ success: false, error: { code: 'NOT_FOUND', message: 'Customer not found' } }, 404);
  }

  // Build conditions
  const conditions = [eq(calls.customerId, customer.id)];
  if (query.agentId) conditions.push(eq(calls.agentId, query.agentId));
  if (query.from) conditions.push(gte(calls.startedAt, new Date(query.from)));
  if (query.to) conditions.push(lte(calls.startedAt, new Date(query.to)));

  const offset = (query.page - 1) * query.pageSize;

  const [callRecords, totalResult] = await Promise.all([
    db.query.calls.findMany({
      where: and(...conditions),
      orderBy: [desc(calls.startedAt)],
      limit: query.pageSize,
      offset,
      with: { agent: { columns: { name: true } } },
    }),
    db
      .select({ count: count() })
      .from(calls)
      .where(and(...conditions)),
  ]);

  const total = totalResult[0]?.count ?? 0;

  return c.json<ApiResponse>({
    success: true,
    data: callRecords.map((call) => ({
      id: call.id,
      callerNumber: call.callerNumber,
      agentNumber: call.agentNumber,
      agentName: call.agent.name,
      direction: call.direction,
      status: call.status,
      durationSeconds: call.durationSeconds,
      summary: call.summary,
      sentiment: call.sentiment,
      appointmentBooked: call.appointmentBooked,
      recordingUrl: call.recordingUrl,
      startedAt: call.startedAt.toISOString(),
    })),
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      total,
    },
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /calls/:id — Get full call detail with transcript
// ═══════════════════════════════════════════════════════════════════

callRoutes.get('/:id', async (c) => {
  const user = c.get('user');
  const callId = c.req.param('id');

  const customer = await db.query.customers.findFirst({
    where: eq(customers.userId, user.sub),
  });

  if (!customer) {
    return c.json<ApiResponse>({ success: false, error: { code: 'NOT_FOUND', message: 'Customer not found' } }, 404);
  }

  const callRecord = await db.query.calls.findFirst({
    where: and(eq(calls.id, callId), eq(calls.customerId, customer.id)),
    with: {
      agent: { columns: { name: true } },
      appointments: true,
    },
  });

  if (!callRecord) {
    return c.json<ApiResponse>({ success: false, error: { code: 'NOT_FOUND', message: 'Call not found' } }, 404);
  }

  return c.json<ApiResponse>({ success: true, data: callRecord });
});

// ═══════════════════════════════════════════════════════════════════
// GET /calls/analytics — Dashboard KPIs
// ═══════════════════════════════════════════════════════════════════

callRoutes.get('/analytics/summary', async (c) => {
  const user = c.get('user');

  const customer = await db.query.customers.findFirst({
    where: eq(customers.userId, user.sub),
  });

  if (!customer) {
    return c.json<ApiResponse>({ success: false, error: { code: 'NOT_FOUND', message: 'Customer not found' } }, 404);
  }

  // Aggregate stats for last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const statsResult = await db
    .select({
      totalCalls: count(),
      totalMinutes: sql<number>`COALESCE(SUM(${calls.durationSeconds}) / 60, 0)`.as('totalMinutes'),
      avgDuration: sql<number>`COALESCE(AVG(${calls.durationSeconds}), 0)`.as('avgDuration'),
      avgSentiment: sql<number>`COALESCE(AVG(${calls.sentiment}), 0)`.as('avgSentiment'),
      appointmentsBooked: sql<number>`COUNT(*) FILTER (WHERE ${calls.appointmentBooked} = true)`.as(
        'appointmentsBooked',
      ),
      missedCalls: sql<number>`COUNT(*) FILTER (WHERE ${calls.status} = 'missed')`.as('missedCalls'),
    })
    .from(calls)
    .where(and(eq(calls.customerId, customer.id), gte(calls.startedAt, thirtyDaysAgo)));

  const stats = statsResult[0];

  return c.json<ApiResponse>({
    success: true,
    data: {
      totalCalls: stats?.totalCalls ?? 0,
      totalMinutes: Math.round(Number(stats?.totalMinutes ?? 0)),
      missedCalls: Number(stats?.missedCalls ?? 0),
      appointmentsBooked: Number(stats?.appointmentsBooked ?? 0),
      averageSentiment: Number(Number(stats?.avgSentiment ?? 0).toFixed(1)),
      averageDuration: Math.round(Number(stats?.avgDuration ?? 0)),
    },
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /calls/calendar — Get all calls for a month (calendar view)
// Returns calls with time, status, duration, recording, agent info
// ═══════════════════════════════════════════════════════════════════

const calendarSchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

callRoutes.get('/calendar/month', zValidator('query', calendarSchema), async (c) => {
  const user = c.get('user');
  const { year, month } = c.req.valid('query');

  const customer = await db.query.customers.findFirst({
    where: eq(customers.userId, user.sub),
  });

  if (!customer) {
    return c.json<ApiResponse>({ success: false, error: { code: 'NOT_FOUND', message: 'Customer not found' } }, 404);
  }

  // Build timezone-aware date range for the month
  // Uses customer's timezone so midnight boundaries are correct
  const customerTz = customer.timezone || 'Europe/Athens';
  const { startDate, endDate } = getMonthRangeInTimezone(year, month, customerTz);

  log.debug({ year, month, timezone: customerTz, startDate: startDate.toISOString(), endDate: endDate.toISOString() }, 'Calendar query range');

  const callRecords = await db.query.calls.findMany({
    where: and(
      eq(calls.customerId, customer.id),
      gte(calls.startedAt, startDate),
      lte(calls.startedAt, endDate),
    ),
    orderBy: [desc(calls.startedAt)],
    with: { agent: { columns: { name: true } } },
  });

  // Return full call data for calendar rendering
  return c.json<ApiResponse>({
    success: true,
    data: callRecords.map((call) => ({
      id: call.id,
      callerNumber: call.callerNumber,
      agentNumber: call.agentNumber,
      agentName: call.agent.name,
      direction: call.direction,
      status: call.status,
      durationSeconds: call.durationSeconds,
      summary: call.summary,
      sentiment: call.sentiment,
      appointmentBooked: call.appointmentBooked,
      recordingUrl: call.recordingUrl,
      transcript: call.transcript,
      startedAt: call.startedAt.toISOString(),
      endedAt: call.endedAt?.toISOString() ?? null,
    })),
    meta: { year, month, total: callRecords.length },
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /calls/e2e-test — Create a simulated test call
// Inserts a realistic call record without needing Telnyx/ElevenLabs
// Marked with metadata.isE2ETest = true for easy cleanup
// ═══════════════════════════════════════════════════════════════════

const e2eTestSchema = z.object({
  agentId: z.string().uuid(),
  durationSeconds: z.number().int().min(5).max(600).optional().default(45),
  status: z.enum(['completed', 'missed', 'voicemail', 'failed']).optional().default('completed'),
  appointmentBooked: z.boolean().optional().default(false),
  sentiment: z.number().int().min(1).max(5).optional().default(4),
  callerNumber: z.string().optional().default('+306900000001'),
});

callRoutes.post('/e2e-test', zValidator('json', e2eTestSchema), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');

  const customer = await db.query.customers.findFirst({
    where: eq(customers.userId, user.sub),
  });

  if (!customer) {
    return c.json<ApiResponse>({ success: false, error: { code: 'NOT_FOUND', message: 'Customer not found' } }, 404);
  }

  // Verify the agent belongs to this customer
  const agent = await db.query.agents.findFirst({
    where: and(eq(agents.id, body.agentId), eq(agents.customerId, customer.id)),
  });

  if (!agent) {
    return c.json<ApiResponse>({ success: false, error: { code: 'NOT_FOUND', message: 'Agent not found' } }, 404);
  }

  // Build realistic call data
  const now = new Date();
  const startedAt = new Date(now.getTime() - body.durationSeconds * 1000);
  const endedAt = now;

  const agentDisplayName = agent.name || 'AI Assistant';
  const transcript = [
    `[Agent]: Γεια σας, ${agent.greeting || 'πώς μπορώ να σας βοηθήσω;'}`,
    `[Customer]: Γεια σας, θα ήθελα κάποιες πληροφορίες.`,
    `[Agent]: Φυσικά! Πώς μπορώ να σας εξυπηρετήσω;`,
    `[Customer]: Θέλω να κλείσω ένα ραντεβού.`,
    `[Agent]: Με χαρά! Ποια ημερομηνία σας βολεύει;`,
    `[Customer]: Αύριο το πρωί αν γίνεται.`,
    `[Agent]: Τέλεια, σας έκλεισα ραντεβού. Υπάρχει κάτι άλλο;`,
    `[Customer]: Όχι, ευχαριστώ πολύ!`,
    `[Agent]: Παρακαλώ! Καλή σας μέρα.`,
  ].join('\n');

  const summary = body.status === 'completed'
    ? `Ο πελάτης κάλεσε τον ${agentDisplayName} και ζήτησε πληροφορίες. ${body.appointmentBooked ? 'Κλείστηκε ραντεβού για αύριο το πρωί.' : 'Η συνομιλία ολοκληρώθηκε επιτυχώς.'}`
    : body.status === 'missed'
      ? 'Αναπάντητη κλήση — ο πελάτης δεν απάντησε.'
      : 'Η κλήση δεν ολοκληρώθηκε.';

  const intentCategory = body.appointmentBooked ? 'appointment_booking' : 'inquiry';

  const [testCall] = await db
    .insert(calls)
    .values({
      customerId: customer.id,
      agentId: agent.id,
      telnyxConversationId: `e2e_test_${crypto.randomUUID()}`,
      callerNumber: body.callerNumber,
      agentNumber: agent.phoneNumber || '+302100000000',
      direction: 'inbound',
      status: body.status,
      startedAt,
      endedAt: body.status === 'completed' ? endedAt : null,
      durationSeconds: body.status === 'completed' ? body.durationSeconds : null,
      transcript: body.status === 'completed' ? transcript : null,
      summary,
      sentiment: body.status === 'completed' ? body.sentiment : null,
      intentCategory,
      appointmentBooked: body.appointmentBooked,
      metadata: { isE2ETest: true, createdBy: 'e2e-test-button' },
    })
    .returning();

  if (!testCall) {
    return c.json<ApiResponse>({ success: false, error: { code: 'INSERT_FAILED', message: 'Failed to create test call' } }, 500);
  }

  log.info({ callId: testCall.id, agentId: agent.id }, '🧪 E2E test call created');

  return c.json<ApiResponse>({
    success: true,
    data: {
      id: testCall.id,
      callerNumber: testCall.callerNumber,
      agentNumber: testCall.agentNumber,
      agentName: agent.name,
      direction: testCall.direction,
      status: testCall.status,
      durationSeconds: testCall.durationSeconds,
      summary: testCall.summary,
      sentiment: testCall.sentiment,
      appointmentBooked: testCall.appointmentBooked,
      startedAt: testCall.startedAt.toISOString(),
      endedAt: testCall.endedAt?.toISOString() ?? null,
      isE2ETest: true,
    },
  }, 201);
});

// ═══════════════════════════════════════════════════════════════════
// DELETE /calls/e2e-test/:id — Delete a test call
// Only allows deletion of calls with metadata.isE2ETest = true
// ═══════════════════════════════════════════════════════════════════

callRoutes.delete('/e2e-test/:id', async (c) => {
  const user = c.get('user');
  const callId = c.req.param('id');

  const customer = await db.query.customers.findFirst({
    where: eq(customers.userId, user.sub),
  });

  if (!customer) {
    return c.json<ApiResponse>({ success: false, error: { code: 'NOT_FOUND', message: 'Customer not found' } }, 404);
  }

  const callRecord = await db.query.calls.findFirst({
    where: and(eq(calls.id, callId), eq(calls.customerId, customer.id)),
  });

  if (!callRecord) {
    return c.json<ApiResponse>({ success: false, error: { code: 'NOT_FOUND', message: 'Call not found' } }, 404);
  }

  // Safety: only delete test calls
  const meta = callRecord.metadata as Record<string, unknown> | null;
  if (!meta || meta.isE2ETest !== true) {
    return c.json<ApiResponse>({ success: false, error: { code: 'FORBIDDEN', message: 'Only test calls can be deleted' } }, 403);
  }

  await db.delete(calls).where(eq(calls.id, callId));

  log.info({ callId }, '🗑️ E2E test call deleted');

  return c.json<ApiResponse>({ success: true, data: { deleted: true } });
});

// ═══════════════════════════════════════════════════════════════════
// DELETE /calls/e2e-test — Delete ALL test calls for current customer
// Bulk cleanup of all E2E test data
// ═══════════════════════════════════════════════════════════════════

callRoutes.delete('/e2e-test', async (c) => {
  const user = c.get('user');

  const customer = await db.query.customers.findFirst({
    where: eq(customers.userId, user.sub),
  });

  if (!customer) {
    return c.json<ApiResponse>({ success: false, error: { code: 'NOT_FOUND', message: 'Customer not found' } }, 404);
  }

  const result = await db
    .delete(calls)
    .where(
      and(
        eq(calls.customerId, customer.id),
        sql`${calls.metadata}->>'isE2ETest' = 'true'`,
      ),
    )
    .returning({ id: calls.id });

  log.info({ count: result.length, customerId: customer.id }, '🗑️ All E2E test calls deleted');

  return c.json<ApiResponse>({ success: true, data: { deletedCount: result.length } });
});

// ═══════════════════════════════════════════════════════════════════
// GET /calls/calendar/appointments — Appointments for a month
// Returns appointments on their SCHEDULED date (not call date)
// ═══════════════════════════════════════════════════════════════════

const appointmentsCalendarSchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

callRoutes.get('/calendar/appointments', zValidator('query', appointmentsCalendarSchema), async (c) => {
  const user = c.get('user');
  const { year, month } = c.req.valid('query');

  const customer = await db.query.customers.findFirst({
    where: eq(customers.userId, user.sub),
  });

  if (!customer) {
    return c.json<ApiResponse>({ success: false, error: { code: 'NOT_FOUND', message: 'Customer not found' } }, 404);
  }

  const customerTz = customer.timezone || 'Europe/Athens';
  const { startDate, endDate } = getMonthRangeInTimezone(year, month, customerTz);

  const appointmentRecords = await db.query.appointments.findMany({
    where: and(
      eq(appointments.customerId, customer.id),
      gte(appointments.scheduledAt, startDate),
      lte(appointments.scheduledAt, endDate),
    ),
    orderBy: [desc(appointments.scheduledAt)],
    with: {
      agent: { columns: { name: true } },
      call: { columns: { id: true, callerNumber: true, summary: true, transcript: true } },
    },
  });

  return c.json<ApiResponse>({
    success: true,
    data: appointmentRecords.map((apt) => ({
      id: apt.id,
      callerName: apt.callerName,
      callerPhone: apt.callerPhone,
      agentName: apt.agent.name,
      serviceType: apt.serviceType,
      scheduledAt: apt.scheduledAt.toISOString(),
      durationMinutes: apt.durationMinutes,
      status: apt.status,
      notes: apt.notes,
      callId: apt.callId,
      callSummary: apt.call?.summary ?? null,
    })),
    meta: { year, month, total: appointmentRecords.length },
  });
});
