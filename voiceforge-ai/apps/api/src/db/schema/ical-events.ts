// ═══════════════════════════════════════════════════════════════════
// VoiceForge AI — iCal Cached Events Schema
// Stores events fetched from external iCal feeds (Google/Outlook/Apple)
// Used to block busy slots during availability checks
// ═══════════════════════════════════════════════════════════════════

import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { customers } from './customers';

// ── Table ────────────────────────────────────────────────────────

export const icalCachedEvents = pgTable(
  'ical_cached_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),

    // Event data from iCal feed
    uid: text('uid').notNull(), // VEVENT UID from the iCal feed
    summary: text('summary'), // Event title / summary
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_ical_events_customer').on(table.customerId),
    index('idx_ical_events_start').on(table.startAt),
    index('idx_ical_events_customer_uid').on(table.customerId, table.uid),
  ],
);

// ── Relations ────────────────────────────────────────────────────

export const icalCachedEventsRelations = relations(icalCachedEvents, ({ one }) => ({
  customer: one(customers, {
    fields: [icalCachedEvents.customerId],
    references: [customers.id],
  }),
}));

// ── Types ────────────────────────────────────────────────────────

export type IcalCachedEventSelect = typeof icalCachedEvents.$inferSelect;
export type IcalCachedEventInsert = typeof icalCachedEvents.$inferInsert;
