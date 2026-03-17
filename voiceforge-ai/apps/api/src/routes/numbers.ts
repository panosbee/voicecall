// ═══════════════════════════════════════════════════════════════════
// VoiceForge AI — Phone Numbers Routes
// Search available Greek numbers + purchase via telephony provider
// Numbers connect to ElevenLabs agents via SIP trunk or native
// ═══════════════════════════════════════════════════════════════════

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { customers, agents } from '../db/schema/index.js';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { createLogger } from '../config/logger.js';
import { getTelephonyProvider } from '../services/telephony/index.js';
import * as elevenlabsService from '../services/elevenlabs.js';
import type { ApiResponse } from '@voiceforge/shared';

const log = createLogger('numbers');

export const numberRoutes = new Hono<{ Variables: { user: AuthUser } }>();

numberRoutes.use('*', authMiddleware);

// ── Validation ───────────────────────────────────────────────────

const searchNumbersSchema = z.object({
  locality: z.string().optional(),
  areaCode: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const purchaseNumberSchema = z.object({
  phoneNumber: z.string().regex(/^\+30\d+$/, 'Must be a Greek +30 number'),
  agentId: z.string().uuid(),
});

// ═══════════════════════════════════════════════════════════════════
// GET /numbers/available — Search available Greek +30 numbers
// Uses master Telnyx API key (no managed accounts needed)
// ═══════════════════════════════════════════════════════════════════

numberRoutes.get('/available', zValidator('query', searchNumbersSchema), async (c) => {
  const query = c.req.valid('query');
  const provider = getTelephonyProvider();

  if (!provider.isConfigured()) {
    return c.json<ApiResponse>(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Τηλεφωνία δεν είναι ρυθμισμένη. Επικοινωνήστε με τον διαχειριστή.' } },
      400,
    );
  }

  try {
    const numbers = await provider.searchAvailableNumbers({
      locality: query.locality,
      areaCode: query.areaCode,
      limit: query.limit,
    });

    return c.json<ApiResponse>({ success: true, data: numbers });
  } catch (error) {
    log.error({ error, provider: provider.name }, 'Failed to search available numbers');
    return c.json<ApiResponse>(
      { success: false, error: { code: 'TELEPHONY_ERROR', message: 'Failed to search phone numbers' } },
      500,
    );
  }
});

// ═══════════════════════════════════════════════════════════════════
// POST /numbers/purchase — Buy a number and assign to agent
// Uses master Telnyx API key, assigns to ElevenLabs agent
// ═══════════════════════════════════════════════════════════════════

numberRoutes.post('/purchase', zValidator('json', purchaseNumberSchema), async (c) => {
  const user = c.get('user');
  const { phoneNumber, agentId } = c.req.valid('json');
  const provider = getTelephonyProvider();

  if (!provider.isConfigured()) {
    return c.json<ApiResponse>(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Τηλεφωνία δεν είναι ρυθμισμένη' } },
      400,
    );
  }

  const customer = await db.query.customers.findFirst({
    where: eq(customers.userId, user.sub),
  });

  if (!customer) {
    return c.json<ApiResponse>({ success: false, error: { code: 'NOT_FOUND', message: 'Customer not found' } }, 404);
  }

  // Verify the agent belongs to this customer
  const agent = await db.query.agents.findFirst({
    where: and(eq(agents.id, agentId), eq(agents.customerId, customer.id)),
  });

  if (!agent) {
    return c.json<ApiResponse>({ success: false, error: { code: 'NOT_FOUND', message: 'Agent not found' } }, 404);
  }

  try {
    log.info({ phoneNumber, agentId, customerId: customer.id, provider: provider.name }, 'Purchasing phone number + setup');

    // ── Step 1: Purchase the phone number ────────────────────
    const order = await provider.purchasePhoneNumber(phoneNumber);
    log.info({ orderId: order.orderId, status: order.status, provider: provider.name }, 'Number purchased');

    // ── Step 2 & 3: SIP wiring (Telnyx) or skip (Twilio) ────
    let connectionId: string | null = null;

    if (provider.requiresSipWiring()) {
      // Telnyx path: Create or reuse SIP connection → ElevenLabs
      connectionId = customer.telnyxConnectionId as string | null;
      if (!connectionId) {
        const sip = await provider.createSipConnection(
          `VoiceForge-${customer.businessName || customer.id}`,
        );
        connectionId = sip.connectionId;

        // Save connection ID on customer for reuse
        await db
          .update(customers)
          .set({ telnyxConnectionId: connectionId })
          .where(eq(customers.id, customer.id));

        log.info({ connectionId }, 'New SIP connection created');
      }

      // Small delay — carrier may need a moment to provision
      await new Promise((r) => setTimeout(r, 2000));

      try {
        await provider.assignNumberToSipConnection(phoneNumber, connectionId);
        log.info({ phoneNumber, connectionId }, 'Number assigned to SIP connection');
      } catch (sipErr) {
        log.warn({ error: sipErr, phoneNumber }, 'SIP assignment failed — number may still be provisioning. Will retry.');
      }
    }

    // ── Step 4: Import number into ElevenLabs ────────────────
    let elevenlabsPhoneNumberId: string | null = null;
    if (agent.elevenlabsAgentId) {
      try {
        const terminationUri = provider.getTerminationUri();
        const elResult = await elevenlabsService.importPhoneNumber({
          phoneNumber,
          agentId: agent.elevenlabsAgentId,
          label: `${agent.name} — ${phoneNumber}`,
          ...(terminationUri ? { terminationUri } : {}),
        });
        elevenlabsPhoneNumberId = elResult.phoneNumberId;
        log.info({ elevenlabsPhoneNumberId, agentId: agent.elevenlabsAgentId }, 'Phone number imported to ElevenLabs');
      } catch (elErr) {
        log.warn({ error: elErr, phoneNumber }, 'ElevenLabs phone import failed — can be retried from dashboard');
      }
    }

    // ── Step 5: Update agent record ──────────────────────────
    await db
      .update(agents)
      .set({
        phoneNumber,
        telnyxNumberOrderId: order.orderId,
        ...(connectionId ? { telnyxConnectionId: connectionId } : {}),
        ...(elevenlabsPhoneNumberId ? { elevenlabsPhoneNumberId } : {}),
        status: elevenlabsPhoneNumberId ? 'active' : 'draft',
        updatedAt: new Date(),
      })
      .where(eq(agents.id, agentId));

    log.info({ phoneNumber, agentId, orderId: order.orderId, elevenlabsPhoneNumberId, provider: provider.name }, 'Full phone setup complete');

    return c.json<ApiResponse>({
      success: true,
      data: {
        phoneNumber,
        orderId: order.orderId,
        status: order.status,
        agentId,
        connectionId,
        elevenlabsPhoneNumberId,
        sipConfigured: !!connectionId,
        elevenlabsConfigured: !!elevenlabsPhoneNumberId,
        provider: provider.name,
        note: elevenlabsPhoneNumberId
          ? 'Ο αριθμός συνδέθηκε με τον AI βοηθό! Δοκιμάστε να τον καλέσετε.'
          : 'Ο αριθμός αγοράστηκε. Η σύνδεση θα ολοκληρωθεί σύντομα.',
      },
    }, 201);
  } catch (error) {
    log.error({ error, phoneNumber, provider: provider.name }, 'Failed to purchase number');
    return c.json<ApiResponse>(
      { success: false, error: { code: 'TELEPHONY_ERROR', message: 'Failed to purchase phone number' } },
      500,
    );
  }
});
