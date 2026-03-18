# VoiceForge AI — Production Readiness Report
> Deep-dive audit conducted: March 18, 2026  
> Codebase commit: `5982b53`  
> Auditor: GitHub Copilot (full static analysis, all 59+ files)

---

## 🎯 Executive Summary

VoiceForge AI is a **mature, well-architected SaaS monorepo** targeting Greek SMEs with AI-powered voice receptionists. The foundation is solid: strong encryption, correct webhook security, Supabase JWT auth, and a comprehensive relational schema. However, the platform is **NOT production-ready** today.

| Category | Score | Status |
|---|---|---|
| Architecture & Code Quality | 8/10 | ✅ Solid |
| Database Schema | 9/10 | ✅ Comprehensive |
| API Completeness | 7/10 | ⚠️ Some gaps |
| Security | 6/10 | ⚠️ Gaps in admin auth + metering |
| Testing | 2/10 | ❌ No test suite found |
| Monitoring & Observability | 1/10 | ❌ None |
| Feature Completeness | 6/10 | ⚠️ Core works; polish missing |
| DevOps & Deployment | 5/10 | ⚠️ Docker OK; CI/CD missing |
| **Overall** | **5.5/10** | **🛑 NOT READY** |

**Estimated time to launch-ready: 4–6 weeks** with 2 engineers.

---

## 📦 What Exists & Works (Strengths)

Before gaps: here is what is solid and working correctly.

### ✅ Core Infrastructure
- **Supabase JWT** — local HS256 verification (fast, no HTTP round-trips to Supabase per request)
- **Drizzle ORM** — full schema with FK constraints, indexes, UUID PKs, JSONB columns
- **AES-256-GCM encryption** — all API keys (Telnyx sub-account keys, Google OAuth tokens) stored encrypted at rest
- **Webhook verification** — Ed25519 (Telnyx), HMAC-SHA256 (Stripe, ElevenLabs) all verifying signatures correctly
- **Rate limiting** — Redis-backed sliding window in production; in-memory in dev; widget routes protected (60 req/min)
- **CORS** — properly scoped; only widget routes use `*`
- **Security headers** — HSTS, X-Frame-Options, X-Content-Type-Options set in nginx
- **Docker** — multi-stage builds, non-root user, resource limits in production compose
- **GDPR** — Article 20 (data export) + Article 17 (right to erasure) endpoints both functional
- **PII redaction** — production logs redact email, phone, names automatically

### ✅ Working Features
- ElevenLabs conversational AI agent creation, update, delete
- Telnyx phone number search and provisioning (+30 Greek numbers)
- Call recording, transcript, sentiment analysis pipeline
- Schedule-X calendar dashboard (month/week/day views)
- iCal feed parsing + caching (`ical_cached_events` table)
- Appointment booking via AI (check_availability + book_appointment client tools)
- Stripe checkout, subscription management, billing portal
- Knowledge Base document upload + ElevenLabs attachment
- Multi-language i18n (EN/EL) throughout the dashboard
- GDPR data export + account deletion
- Onboarding flow (4 steps) with agent test preview
- Admin routes (license generation, registration approval, customer activation)
- Caller memory (phone number history for personalized calls)
- Push notification infrastructure (VAPID keys configured)

---

## 🚨 P0 — Production Blockers (Must Fix Before First Customer)

These issues **will cause revenue loss, security breaches, or broken core features** in production.

---

### P0-1: No Usage Metering → Revenue Leak
**Risk**: Customers can make unlimited calls beyond their plan's minute quota with zero billing impact.

**What exists**: `calls` table records calls. Plan limits defined in `packages/shared/src/constants.ts`. Stripe subscription working.

**What's missing**: No call-minute counter per billing cycle. No Stripe Meter API reporting. No overage enforcement (throttle or charge).

**Fix**:
```sql
-- Add to calls table
ALTER TABLE calls ADD COLUMN duration_seconds INTEGER;
ALTER TABLE calls ADD COLUMN minutes_billed DECIMAL(8,2);

-- New: usage_records table
CREATE TABLE usage_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id),
  billing_period_start TIMESTAMPTZ,
  billing_period_end TIMESTAMPTZ,
  minutes_used DECIMAL(8,2) DEFAULT 0,
  minutes_limit INTEGER,
  overage_minutes DECIMAL(8,2) DEFAULT 0,
  reported_to_stripe BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Backend changes**:
1. In `elevenlabs-webhooks.ts` post-conversation handler → calculate `duration_seconds`, update `calls` record
2. Create `usageService.reportUsage(customerId, minutes)` that calls `stripe.billing.meterEvents.create()`
3. Worker: nightly job to aggregate and report to Stripe
4. Soft-limit enforcement: if customer exceeds quota, pause agent (PATCH `/elevenlabs/agents/:id` status → paused)

**Effort**: 5 days

---

### P0-2: Admin Secret Hardcoded / No Proper Admin Auth
**Risk**: Default fallback `ADMIN_SECRET=voiceforge-admin-2026` is in ecosystem.config.cjs. Anyone with repo access can access the admin API.

**What exists**: `ADMIN_SECRET` header auth on all `/admin/*` routes.

**Fix**:
1. Remove any default value for `ADMIN_SECRET` in `ecosystem.config.cjs` and `env.ts`
2. Add strict validation: throw if `ADMIN_SECRET` not set in production
3. Implement rate limiting on admin routes (max 5 attempts/min per IP)
4. Add IP allowlist for admin panel (office IP + VPN only)
5. Long-term: replace with Supabase service-role + OTP 2FA

**Effort**: 1 day (immediate)

```typescript
// apps/api/src/config/env.ts — add to Zod schema
ADMIN_SECRET: z.string().min(32, 'ADMIN_SECRET must be at least 32 chars'),
```

---

### P0-3: Email Notifications Not Integrated
**Risk**: Appointment confirmations, call summaries, and license activation emails are never sent. Core promised feature.

**What exists**: `Resend` SDK installed. `sendCallSummaryEmail()` and `sendLicenseKeyEmail()` stubs in `apps/api/src/services/email.ts`. Email templates partially written.

**What's missing**: Resend API is never called. Templates not finalized. No email queue.

**Fix — `apps/api/src/services/email.ts`**:
```typescript
import { Resend } from 'resend';

const resend = new Resend(env.RESEND_API_KEY);

export async function sendAppointmentConfirmation(params: {
  to: string;
  customerName: string;
  callerName: string;
  callerPhone: string;
  scheduledAt: Date;
  serviceType: string;
  agentName: string;
}) {
  await resend.emails.send({
    from: 'VoiceForge AI <noreply@voiceforge.ai>',
    to: params.to,
    subject: `Νέο Ραντεβού: ${params.callerName} — ${formatDate(params.scheduledAt)}`,
    html: appointmentConfirmationTemplate(params),
  });
}
```

**Integration points**:
- `elevenlabs-webhooks.ts` → `book_appointment` tool handler → call `sendAppointmentConfirmation()`
- `elevenlabs-webhooks.ts` → post-conversation webhook → call `sendCallSummaryEmail()`
- `customers.ts` activate route → call `sendLicenseKeyEmail()`

**Effort**: 3 days (templates + integration + test)

---

### P0-4: No Backup Strategy
**Risk**: Database corruption or accidental deletion = permanent data loss. Customer call history, appointments, configurations are unrecoverable.

**Fix**:
```bash
# Automated PostgreSQL backup script (cron: 0 2 * * *)
#!/bin/bash
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="voiceforge_$TIMESTAMP.sql.gz"
pg_dump $DATABASE_URL | gzip > /backups/$BACKUP_FILE
# Upload to S3/DigitalOcean Spaces
s3cmd put /backups/$BACKUP_FILE s3://voiceforge-backups/daily/$BACKUP_FILE
# Clean up local + keep last 7 days
find /backups -name "*.sql.gz" -mtime +7 -delete
```

**Requirements**:
- S3-compatible storage (DigitalOcean Spaces recommended: €5/month)
- Retention: daily backups for 30 days, weekly for 1 year
- Restore drill: monthly test restore to staging
- Point-in-time recovery: enable Supabase PITR if using managed Supabase

**Effort**: 1 day

---

## 🟡 P1 — Important (Fix in First 2 Weeks Post-Launch)

---

### P1-1: No Monitoring or Alerting
**Risk**: Production outages go undetected until a customer reports them. No performance visibility.

**What's needed**:
- **APM**: Application performance monitoring (response times, error rates, DB query times)
- **Uptime monitoring**: External synthetic checks on `/health` endpoint
- **Error tracking**: Exception aggregation with stack traces
- **Log aggregation**: Structured JSON logs searchable in one place
- **Alerting**: PagerDuty/Slack alerts on error spikes, downtime, memory exhaustion

**Recommended stack**:
```
Option A (All-in-one, recommended):
  Grafana Cloud — free tier (10K metrics, 50GB logs)
  ├── Prometheus metrics (node-prometheus in API)
  ├── Loki log aggregation (JSON structured logs already ready)
  └── Grafana dashboards + alerting

Option B (Hosted, pay-as-you-go):
  Datadog — starts at ~$15/host/month
  └── One agent, APM + logs + metrics + alerts
```

**Implementation** (apps/api/src/index.ts):
```typescript
import { prometheus } from '@hono/prometheus';
app.use('*', prometheus());
// Exposes /metrics endpoint for Prometheus scraping
```

**Effort**: 3 days

---

### P1-2: No CI/CD Pipeline
**Risk**: Manual deployment is error-prone. No automated testing gate before production push.

**Fix — `.github/workflows/deploy.yml`**:
```yaml
name: CI/CD — Deploy to Production

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - run: pnpm install
      - run: pnpm typecheck
      - run: pnpm build

  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to Droplet
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.DROPLET_IP }}
          username: deploy
          key: ${{ secrets.DEPLOY_KEY }}
          script: |
            cd /app
            git pull origin main
            pnpm install --frozen-lockfile
            pnpm build
            pm2 reload ecosystem.config.cjs --env production
```

**Effort**: 1 day

---

### P1-3: Phone Number Provisioning Reliability
**Risk**: Customer purchases a phone number but the SIP trunk wiring to ElevenLabs fails silently. Number is bought, money charged, but phone never rings.

**What exists**: `numbers.ts` buys the number, creates SIP connection, assigns to ElevenLabs — all as sequential HTTP calls with no retry.

**Fix**:
1. Add exponential retry wrapper for each SIP wiring step
2. Store provisioning state in DB (`agents.telnyxConnectionId`, `agents.elevenlabsPhoneNumberId`)
3. Create `/api/numbers/repair/:agentId` endpoint to re-run failed SIP wiring
4. Surface error status in agent card UI ("Phone connection failed — click to repair")

**Effort**: 2–3 days

---

### P1-4: No Test Suite
**Risk**: Any refactor or new feature can silently break existing functionality. High-risk for billing, webhooks, appointments.

**Recommended test pyramid**:

```
Unit tests (Jest):
  - services/encryption.ts
  - services/stripe.ts (mock Stripe SDK)
  - services/telnyx.ts (mock Telnyx SDK)
  - Webhook signature verification functions

Integration tests (Jest + test DB):
  - POST /webhooks/elevenlabs/server-tool (all 5 tools)
  - GET /api/calls (pagination + filters)
  - Appointment booking flow end-to-end

E2E tests (Playwright):
  - Onboarding flow (registration → agent creation → test call)
  - Billing checkout (Stripe test mode)
  - Calendar appointment booking
```

**Effort**: 2 weeks (can be done in parallel with other work)

---

## 🟠 P2 — Required for Stable Operations

---

### P2-1: Staging Environment
Every production change needs a staging environment with real Telnyx/ElevenLabs test accounts.

**Setup**:
1. Duplicate DigitalOcean Droplet (or use App Platform Preview)
2. Separate `.env.staging` with:
   - Telnyx developer account
   - ElevenLabs free-tier account
   - Stripe test-mode keys
   - Separate Supabase project
3. Deploy to staging on every PR (GitHub Actions)
4. Run Playwright smoke tests against staging before merging to main

**Effort**: 2 days

---

### P2-2: TLS / SSL Certificate Management
**Current state**: Nginx config references SSL paths but no automated certificate issuance.

**Fix**:
```bash
# Install Certbot
sudo snap install certbot --classic
sudo certbot --nginx -d api.voiceforge.ai -d voiceforge.ai
# Auto-renewal cron
echo "0 12 * * * /usr/bin/certbot renew --quiet" | sudo tee -a /etc/crontab
```

**Effort**: 2 hours

---

### P2-3: Admin UI (Next.js pages under `/admin`)
**Current state**: All admin API routes are functional. Zero frontend.

**What's needed**:
- `/admin` — Login page (ADMIN_SECRET entry)
- `/admin/dashboard` — Stats: total customers, active subscriptions, revenue, calls/day
- `/admin/registrations` — Approve/reject pending license registrations
- `/admin/licenses` — Generate, revoke, view license keys
- `/admin/customers` — View/search customers, suspend accounts, impersonate

**Effort**: 1–2 weeks

---

### P2-4: Google Calendar Write-Back
**Current state**: OAuth token stored and OAuth flow exists. Calendar reads (availability checks via iCal) work. Calendar does NOT write events back when appointments are booked.

**Fix** — implement `createCalendarEvent()` in `apps/api/src/services/ical.ts`:
```typescript
export async function createGoogleCalendarEvent(params: {
  accessToken: string;
  calendarId: string;
  title: string;
  startTime: Date;
  endTime: Date;
  description?: string;
  attendeePhone?: string;
}): Promise<string> {
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${params.calendarId}/events`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary: params.title,
        description: params.description,
        start: { dateTime: params.startTime.toISOString() },
        end: { dateTime: params.endTime.toISOString() },
      }),
    }
  );
  const event = await response.json();
  return event.id; // store as appointments.googleEventId
}
```

**Effort**: 2–3 days

---

### P2-5: Push Notifications
**Current state**: VAPID keys in env. Service worker not registered. No notification sending code.

**Fix**:
1. `apps/web/public/sw.js` — Service Worker with push event handler
2. `apps/web/src/hooks/usePushNotifications.ts` — subscribe on first login
3. `apps/api/src/routes/notifications.ts` — store push subscription per user
4. `apps/api/src/services/push.ts` — send on call events

```typescript
// apps/api/src/services/push.ts
import webpush from 'web-push';

webpush.setVapidDetails(
  `mailto:${env.VAPID_EMAIL}`,
  env.VAPID_PUBLIC_KEY,
  env.VAPID_PRIVATE_KEY
);

export async function sendPushNotification(subscription: PushSubscription, payload: {
  title: string;
  body: string;
  url?: string;
}) {
  await webpush.sendNotification(subscription, JSON.stringify(payload));
}
```

**Effort**: 2 days

---

## 🔵 P3 — Feature Completion (Post-Stable Launch)

---

### P3-1: SMS Appointment Confirmations
Telnyx SMS SDK is installed and configured. `TELNYX_SMS_FROM_NUMBER` is in env.

**What's needed**: Call `telnyx.messages.create()` after booking.

```typescript
// In book_appointment tool handler
if (customer.plan !== 'basic' || features.includes('sms_confirmation')) {
  await telnyx.messages.create({
    from: env.TELNYX_SMS_FROM_NUMBER,
    to: callerPhone,
    text: `✅ Ραντεβού: ${scheduledAt} — ${businessName}. Για ακύρωση καλέστε ${agentPhone}.`,
  });
}
```

**Effort**: 1 day

---

### P3-2: Multi-Agent Flows UI
**Current state**: `agent_flows` table fully defined. API routes (`GET/POST/PATCH /api/flows`) exist. Dashboard page exists. Visual routing editor is incomplete.

**What's needed**:
- Drag-and-drop flow builder (React Flow or similar)
- Visual routing rule editor
- Test flow button
- Real-time call routing visualization

**Effort**: 2 weeks (complex UI)

---

### P3-3: Advanced Analytics
**Current state**: Basic KPIs (30-day calls, appointments, sentiment avg). No time-series charts, no cohort analysis, no revenue attribution.

**What's needed**:
- Call volume over time (line chart)
- Appointment conversion rate by agent
- Peak call hours heatmap
- Customer retention metrics
- Revenue per customer

**Effort**: 1 week

---

### P3-4: Landing Page Builder
**Current state**: Pro/Enterprise plans include "1 annual landing page". Not built.

**Effort**: 2–4 weeks

---

### P3-5: Dark Mode
**Current state**: Tailwind `dark:` classes partially present but not togglable.

**Effort**: 2–3 days

---

## 🔐 Complete Environment Variables Reference

All env vars consumed across the entire codebase (`apps/api` + `apps/web`):

### API — `apps/api/.env`

```env
# ── Core ──────────────────────────────────────────────────────
NODE_ENV=production
PORT=3001
API_BASE_URL=https://api.voiceforge.ai
FRONTEND_URL=https://voiceforge.ai
LOG_LEVEL=info

# ── Database ──────────────────────────────────────────────────
DATABASE_URL=postgresql://voiceforge:<password>@127.0.0.1:5432/voiceforge
REDIS_URL=redis://:password@127.0.0.1:6379

# ── Security ──────────────────────────────────────────────────
ENCRYPTION_KEY=<64 hex chars — generate: openssl rand -hex 32>
ADMIN_SECRET=<minimum 32 chars — generate: openssl rand -base64 32>
SUPABASE_JWT_SECRET=<from Supabase Dashboard → Settings → API>

# ── Supabase ──────────────────────────────────────────────────
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_ANON_KEY=eyJh...
SUPABASE_SERVICE_ROLE_KEY=eyJh...

# ── Telephony (Telnyx) ────────────────────────────────────────
TELNYX_API_KEY=KEY...
TELNYX_PUBLIC_KEY=<Ed25519 public key from Telnyx portal>
TELNYX_MESSAGING_PROFILE_ID=<profile UUID>
TELNYX_SMS_FROM_NUMBER=+30...

# ── ElevenLabs ────────────────────────────────────────────────
ELEVENLABS_API_KEY=sk_...
ELEVENLABS_WEBHOOK_SECRET=<from ElevenLabs dashboard>
ELEVENLABS_VOICE_ID=aTP4J5SJLQl74WTSRXKW

# ── Stripe ────────────────────────────────────────────────────
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_BASIC_PRICE_ID=price_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_ENTERPRISE_PRICE_ID=price_...

# ── Email (Resend) ────────────────────────────────────────────
RESEND_API_KEY=re_...

# ── Push Notifications ────────────────────────────────────────
VAPID_PUBLIC_KEY=<generate: npx web-push generate-vapid-keys>
VAPID_PRIVATE_KEY=<from above command>
VAPID_EMAIL=admin@voiceforge.ai

# ── Google Calendar (Optional) ────────────────────────────────
GOOGLE_CLIENT_ID=<from Google Cloud Console>
GOOGLE_CLIENT_SECRET=<from Google Cloud Console>
GOOGLE_REDIRECT_URI=https://voiceforge.ai/oauth/callback

# ── GDPR / Data Retention ─────────────────────────────────────
DATA_RETENTION_CALLS_DAYS=365
DATA_RETENTION_WEBHOOKS_DAYS=90
```

### Web — `apps/web/.env.local`

```env
# ── Supabase (Public) ─────────────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJh...

# ── API ───────────────────────────────────────────────────────
NEXT_PUBLIC_API_URL=https://api.voiceforge.ai

# ── App ───────────────────────────────────────────────────────
NEXT_PUBLIC_APP_URL=https://voiceforge.ai

# ── Dev Auth (Development ONLY — must NOT be in production) ───
NEXT_PUBLIC_DEV_AUTH=false

# ── Push Notifications ────────────────────────────────────────
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<same VAPID_PUBLIC_KEY from above>
```

---

## 🗄️ Database Schema Summary

All 12 tables currently defined:

| Table | Purpose | Relations |
|---|---|---|
| `customers` | B2B account + all integrations | Root entity |
| `agents` | AI agent config + voice settings | FK → customers |
| `calls` | Call records, transcripts, sentiment | FK → customers, agents |
| `appointments` | Booked appointments from calls | FK → customers, agents, calls |
| `knowledge_base_documents` | RAG files for agents | FK → customers, agents |
| `agent_flows` | Multi-agent routing trees | FK → customers |
| `webhook_events` | Idempotency for webhooks | Standalone |
| `license_keys` | B2B license management | FK → customers (nullable) |
| `audit_logs` | GDPR audit trail | FK → customers |
| `caller_memories` | Per-phone caller history | FK → customers, agents |
| `ical_cached_events` | iCal feed cache | FK → customers |
| `pending_registrations` | License activation queue | Standalone |

**Missing tables to add**:
- `usage_records` — for billing metering (P0-1)
- `push_subscriptions` — for push notifications (P2-5)
- `email_queue` — for reliable email delivery (P0-3)

---

## 🏗️ Infrastructure Checklist

### Production Server (DigitalOcean)
- [ ] Ubuntu 22.04 LTS Droplet (2 vCPU, 4GB RAM)
- [ ] Firewall: only ports 22, 80, 443 open
- [ ] Non-root deploy user with SSH key
- [ ] Docker + Docker Compose installed
- [ ] PM2 (global, for process management)
- [ ] `/etc/environment` with all production env vars
- [ ] `/app` directory owned by deploy user
- [ ] Nightly script to pull updates and restart

### SSL / TLS
- [ ] Let's Encrypt certificate for `voiceforge.ai` + `api.voiceforge.ai`
- [ ] Certbot auto-renewal cron (`0 12 * * * certbot renew --quiet`)
- [ ] HSTS header in nginx (already in nginx.conf ✅)
- [ ] OCSP stapling enabled

### Database
- [ ] PostgreSQL 16 running (Docker or Supabase managed)
- [ ] `DATABASE_URL` using `sslmode=require` in production
- [ ] All Drizzle migrations run on first deploy
- [ ] Automated daily backup to S3/Spaces
- [ ] pgAdmin access blocked from public internet

### Redis
- [ ] Redis 7 running (Docker or DigitalOcean managed Redis)
- [ ] Password-protected (`requirepass` in redis.conf)
- [ ] `maxmemory-policy allkeys-lru` set
- [ ] Only accessible from localhost

### Nginx
- [ ] Reverse proxy for API (`:3001`) and Web (`:3000`)
- [ ] HTTP → HTTPS redirect
- [ ] Rate limiting at nginx level (backup to API rate limiting)
- [ ] Gzip compression for static assets
- [ ] Request size limit 10MB max

### Monitoring
- [ ] `/health` endpoint returning HTTP 200 + DB status
- [ ] External uptime monitor (UptimeRobot free tier = 5 min checks)
- [ ] Grafana + Prometheus for metrics
- [ ] Loki for log aggregation
- [ ] PagerDuty or Slack webhook for outage alerts
- [ ] Error tracking (Sentry free tier)

---

## 📊 Supabase Configuration Checklist

Since the app uses Supabase for auth + database, these need to be configured:

### Supabase Dashboard Settings

- [ ] **Authentication → Email**: Confirm email template matches brand
- [ ] **Authentication → Email**: Set `Site URL` to `https://voiceforge.ai`
- [ ] **Authentication → Redirect URLs**: Add `https://voiceforge.ai/**`
- [ ] **Authentication → Providers**: Enable Email+Password (or Magic Link)
- [ ] **Authentication → SMTP**: Configure custom SMTP (or use Resend integration in Supabase)
- [ ] **API → JWT Secret**: Copy value to `SUPABASE_JWT_SECRET` in API env
- [ ] **Database → Extensions**: Enable `uuid-ossp`, `pgcrypto`
- [ ] **Database → SSL**: Enforce SSL for all connections (production)
- [ ] **Storage** (if using for call recordings): Set bucket policies
- [ ] **Point-in-Time Recovery**: Enable if on Pro plan ($25/month)

### Row Level Security (RLS)

Currently NOT using Supabase RLS because the API verifies ownership in application code (checking `customer.id` in every query). This is acceptable but if you ever expose Supabase directly (Realtime subscriptions, etc.), you MUST add:

```sql
-- Example RLS policy for calls table
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customers_own_calls" ON calls
  FOR ALL USING (
    customer_id = (
      SELECT id FROM customers WHERE user_id = auth.uid()
    )
  );
```

**Recommendation**: Add RLS as a defense-in-depth measure even if not strictly required now.

---

## 🚀 Deployment Sequence (First Production Deploy)

Follow this exact order:

```
Step 1: Provision Server
  └── DigitalOcean Droplet (Ubuntu 22.04, 2 vCPU, 4GB)
  └── Configure firewall (ports 22, 80, 443)
  └── Create deploy user, add SSH key

Step 2: Install Dependencies
  └── Docker + Docker Compose
  └── Node 20 + pnpm
  └── PM2 (npm install -g pm2)
  └── Certbot (snap install certbot)

Step 3: Configure DNS
  └── A record: voiceforge.ai → Droplet IP
  └── A record: api.voiceforge.ai → Droplet IP
  └── Wait for propagation (~5 min)

Step 4: Issue SSL Certificate
  └── certbot --nginx -d voiceforge.ai -d api.voiceforge.ai

Step 5: Set Environment Variables
  └── Create /app/.env.production (API vars)
  └── Create /app/apps/web/.env.production (web vars)
  └── Never commit these files

Step 6: Database Setup
  └── docker-compose -f docker-compose.production.yml up -d postgres redis
  └── pnpm db:migrate (run Drizzle migrations)
  └── Verify: psql $DATABASE_URL -c "\dt"

Step 7: Configure External Services
  └── Supabase: Set Site URL + Redirect URLs
  └── Stripe: Set webhook endpoint (https://api.voiceforge.ai/webhooks)
  └── Telnyx: Set webhook endpoint for post-call
  └── ElevenLabs: Set webhook endpoint

Step 8: Build & Start
  └── pnpm build
  └── pm2 start ecosystem.config.cjs --env production
  └── pm2 save
  └── pm2 startup (auto-start on reboot)

Step 9: Verify
  └── curl https://api.voiceforge.ai/health
  └── Open https://voiceforge.ai
  └── Test login + agent creation + test call

Step 10: Monitoring
  └── Register uptime monitor (UptimeRobot)
  └── Set up backup cron
  └── Enable PM2 log rotation
```

---

## 📋 Final Pre-Launch Checklist

### Security
- [ ] `ADMIN_SECRET` is random, min 32 chars, not in git
- [ ] `ENCRYPTION_KEY` is 64 hex chars, backed up securely
- [ ] All `.env` files excluded from git (verify `.gitignore`)
- [ ] API keys rotated (fresh keys, not dev keys)
- [ ] Stripe in live mode (not test mode)
- [ ] ElevenLabs webhook secret configured
- [ ] Telnyx webhook secret configured

### Features
- [ ] New user registration → email received ← **P0-3**
- [ ] Appointment booking → confirmation email sent ← **P0-3**
- [ ] Stripe payment → subscription activated correctly
- [ ] Call completed → transcript + sentiment saved
- [ ] iCal sync working (test with real Google Calendar URL)
- [ ] Phone number purchase → agent rings on test call
- [ ] Admin panel accessible at `/admin`

### Operational
- [ ] `/health` returns `{"status":"ok","db":"ok"}`
- [ ] PM2 processes stay up for 24 hours without restart
- [ ] Database backup runs and a backup file exists
- [ ] SSL certificate valid and auto-renewing
- [ ] Uptime monitor alerting configured and tested
- [ ] Stripe webhook receiving and processing events

### Legal / GDPR
- [ ] Privacy Policy accessible at `/privacy`
- [ ] Terms of Service accessible at `/terms`
- [ ] Cookie consent banner shown to new users
- [ ] GDPR data export works end-to-end
- [ ] GDPR account deletion works end-to-end
- [ ] `DATA_RETENTION_CALLS_DAYS` worker scheduled and running

---

## 📈 Recommended Launch Roadmap

```
Week 1–2: P0 Fixes (Blockers)
  ├── Fix admin secret (1 day)
  ├── Implement email notifications (3 days)
  ├── Implement call minute metering (3 days)
  └── Set up automated DB backups (1 day)

Week 3: P1 Infrastructure
  ├── Set up CI/CD GitHub Actions (1 day)
  ├── Deploy staging environment (2 days)
  └── Integrate monitoring — Sentry + UptimeRobot (2 days)

Week 4: Pre-Launch Hardening
  ├── Load test (k6 or Artillery — 100 concurrent users)
  ├── Write incident runbooks
  ├── Customer onboarding documentation
  └── First production deployment

Week 5–6: Stabilization
  ├── Bug fixes from first customers
  ├── Admin UI (most critical screens)
  └── Phone provisioning reliability fixes

Week 7–8: Feature Polish
  ├── Push notifications
  ├── Google Calendar write-back
  ├── SMS confirmations
  └── Advanced analytics

Week 9+: Growth Features
  ├── Landing page builder
  ├── Multi-agent flows UI
  ├── Mobile optimization
  └── Dark mode
```

---

*Report generated by full static analysis of all 59+ files in the VoiceForge AI monorepo. Commit hash: `5982b53` | March 18, 2026.*
