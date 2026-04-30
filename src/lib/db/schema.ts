import {
  pgTable, uuid, text, timestamp, jsonb, boolean, integer,
  smallint, bigserial, index, unique,
} from "drizzle-orm/pg-core";

export const events = pgTable("events", {
  eventId:        uuid("event_id").primaryKey(),
  eventType:      text("event_type").notNull(),
  emittedAt:      timestamp("emitted_at", { withTimezone: true }).notNull(),
  receivedAt:     timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  schemaVersion:  smallint("schema_version").notNull(),
  scope:          jsonb("scope").notNull(),
  payload:        jsonb("payload").notNull(),
  rawEnvelope:    jsonb("raw_envelope").notNull(),
  signatureValid: boolean("signature_valid").notNull(),
  status:         text("status").notNull().default("received"),
}, (t) => ({
  byType:    index("events_event_type_idx").on(t.eventType),
  byTime:    index("events_received_at_idx").on(t.receivedAt),
  pending:   index("events_status_idx").on(t.status),
}));

export const deliveries = pgTable("deliveries", {
  id:            bigserial("id", { mode: "number" }).primaryKey(),
  eventId:       uuid("event_id").notNull().references(() => events.eventId, { onDelete: "cascade" }),
  handlerId:     text("handler_id").notNull(),
  attempt:       integer("attempt").notNull().default(1),
  status:        text("status").notNull(),
  outcome:       jsonb("outcome"),
  crmRecordId:   text("crm_record_id"),
  errorCode:     text("error_code"),
  errorMessage:  text("error_message"),
  startedAt:     timestamp("started_at", { withTimezone: true }),
  completedAt:   timestamp("completed_at", { withTimezone: true }),
  nextRetryAt:   timestamp("next_retry_at", { withTimezone: true }),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byEvent:  index("deliveries_event_id_idx").on(t.eventId),
  pending:  index("deliveries_status_idx").on(t.status, t.nextRetryAt),
  unique:   unique("deliveries_unique").on(t.eventId, t.handlerId, t.attempt),
}));

export const retryQueue = pgTable("retry_queue", {
  id:           bigserial("id", { mode: "number" }).primaryKey(),
  eventId:      uuid("event_id").notNull(),
  handlerId:    text("handler_id").notNull(),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
  attempt:      integer("attempt").notNull().default(1),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  bySchedule: index("retry_queue_scheduled_idx").on(t.scheduledFor),
}));

export const configOverrides = pgTable("config_overrides", {
  eventType:  text("event_type").primaryKey(),
  enabled:    boolean("enabled").notNull().default(true),
  handlerId:  text("handler_id").notNull(),
  config:     jsonb("config").notNull().default({}),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
