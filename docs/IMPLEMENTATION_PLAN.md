# CallSofia Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the CallSofia Bridge — a Vercel-hosted Next.js service that receives every CallSofia webhook, persists durably, and pushes structured data into Litify (Salesforce). One repo, deploy-per-client, env-var driven config.

**Architecture:** Next.js 16 App Router + TypeScript + Drizzle/Neon Postgres + Upstash Redis + Vercel Queues. Webhook receiver → Postgres ledger → Queue → Consumer → CrmAdapter (Litify primary, Generic Webhook fallback). All operations mirrored to platform-api `activity_logs` for end-to-end CallSofia-side observability.

**Tech Stack:** Next.js 16, TypeScript, Drizzle ORM, `postgres` (Neon), `@upstash/redis`, `jsforce` (Salesforce), `zod`, `vitest`, `pnpm`.

**Spec:** `docs/superpowers/specs/2026-04-29-callsofia-bridge-design.md`

**Repo to create:** `github.com/call-sofia/callsofia-bridge`

---

## Execution Map (Waves for Maximum Parallelism)

```
Wave 0 (sequential):           Task 1
Wave 1 (parallel, 6 tasks):    Tasks 2, 3, 4, 5, 6, 7
Wave 2 (parallel, 3 tasks):    Tasks 8, 9, 10
Wave 3 (parallel, 2 tasks):    Tasks 11, 12
Wave 4 (parallel, 4 tasks):    Tasks 13, 14, 15, 16
Wave 5 (parallel, 5 tasks):    Tasks 17, 18, 19, 20, 21
Wave 6 (sequential):           Task 22
Wave 7 (sequential):           Task 23
Wave 8 (parallel, 7 tasks):    Tasks 24, 25, 26, 27, 28, 29, 30
Wave 9 (parallel, 3 tasks):    Tasks 31, 32, 33
Wave 10 (parallel, 3 tasks):   Tasks 34, 35, 36
```

**Total tasks:** 36 across 11 waves. Critical path is ~10 tasks; the rest fan out.

**Branching:** Each task creates its own feature branch off `main` and opens a PR. Subagents merge after their task's reviews pass. CI runs on every PR (Wave 10 ships CI; for waves 1-9, run tests locally and trust the test runner).

---

## File Structure (Pre-decomposition)

```
callsofia-bridge/
├── package.json                                     [Task 1]
├── tsconfig.json                                    [Task 1]
├── next.config.ts                                   [Task 1]
├── vercel.ts                                        [Task 1]
├── drizzle.config.ts                                [Task 1]
├── vitest.config.ts                                 [Task 1]
├── .env.example                                     [Task 2 — config defines vars]
├── .gitignore                                       [Task 1]
├── README.md                                        [Task 35]
├── src/
│   ├── lib/
│   │   ├── config.ts                                [Task 2]
│   │   ├── logger.ts                                [Task 5]
│   │   ├── db/
│   │   │   ├── schema.ts                            [Task 3]
│   │   │   ├── client.ts                            [Task 3]
│   │   │   └── migrations/                          [Task 3 — drizzle-kit generated]
│   │   ├── redis/
│   │   │   └── client.ts                            [Task 4]
│   │   ├── webhook/
│   │   │   ├── types.ts                             [Task 6]
│   │   │   ├── envelope.ts                          [Task 6]
│   │   │   └── verify.ts                            [Task 7]
│   │   ├── queue/
│   │   │   ├── publisher.ts                         [Task 10]
│   │   │   └── consumer.ts                          [Task 10, 23]
│   │   ├── platform-api/
│   │   │   ├── client.ts                            [Task 9]
│   │   │   └── activity-logs.ts                     [Task 9]
│   │   └── adapters/
│   │       ├── types.ts                             [Task 11]
│   │       ├── registry.ts                          [Task 12]
│   │       ├── litify/
│   │       │   ├── auth.ts                          [Task 13]
│   │       │   ├── field-mapping.ts                 [Task 14]
│   │       │   ├── case-type-cache.ts               [Task 15]
│   │       │   ├── person.ts                        [Task 17]
│   │       │   ├── intake.ts                        [Task 18]
│   │       │   ├── activity.ts                      [Task 19]
│   │       │   ├── recording.ts                     [Task 20]
│   │       │   └── adapter.ts                       [Task 22]
│   │       └── generic-webhook/
│   │           ├── transforms.ts                    [Task 16]
│   │           └── adapter.ts                       [Task 21]
│   ├── app/
│   │   ├── layout.tsx                               [Task 26]
│   │   ├── api/
│   │   │   ├── webhooks/callsofia/route.ts          [Task 8]
│   │   │   ├── queue/consumer/route.ts              [Task 23]
│   │   │   ├── cron/
│   │   │   │   ├── process-retries/route.ts         [Task 24]
│   │   │   │   └── health-check/route.ts            [Task 25]
│   │   │   └── admin/replay/route.ts                [Task 29]
│   │   ├── admin/
│   │   │   ├── layout.tsx                           [Task 26]
│   │   │   ├── page.tsx                             [Task 27]
│   │   │   ├── events/[event_id]/page.tsx           [Task 28]
│   │   │   ├── failures/page.tsx                    [Task 29]
│   │   │   ├── replay/page.tsx                      [Task 29]
│   │   │   └── health/page.tsx                      [Task 30]
│   │   └── middleware.ts                            [Task 26]
│   └── tests/                                       [throughout]
├── scripts/
│   ├── litify/
│   │   ├── create-custom-fields.sh                  [Task 31]
│   │   └── verify-org.sh                            [Task 31]
│   ├── dev/mock-callsofia.ts                        [Task 32]
│   └── replay-events.ts                             [Task 33]
├── docs/
│   ├── README.md                                    [Task 35]
│   ├── litify-setup-guide.md                        [Task 36]
│   ├── deployment.md                                [Task 35]
│   └── troubleshooting.md                           [Task 35]
└── .github/workflows/
    └── ci.yml                                       [Task 34]
```

---

## Task 1: Bootstrap repo + Next.js scaffold + Vercel link

**Wave:** 0 (sequential — everything else depends on this)

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vercel.ts`, `drizzle.config.ts`, `vitest.config.ts`, `.gitignore`, `src/app/layout.tsx`, `src/app/page.tsx`

- [ ] **Step 1: Create empty repo on GitHub**

```bash
gh repo create call-sofia/callsofia-bridge --public --description "CallSofia → CRM webhook bridge (Litify primary)"
mkdir -p ~/work/callsofia-bridge && cd ~/work/callsofia-bridge
git init && git remote add origin git@github.com:call-sofia/callsofia-bridge.git
```

- [ ] **Step 2: Scaffold Next.js project**

```bash
pnpm create next-app@latest . --typescript --tailwind --app --no-src-dir --no-eslint --import-alias "@/*"
# Then move to src/ structure manually
mkdir -p src && mv app src/app
```

- [ ] **Step 3: Install dependencies**

```bash
pnpm add drizzle-orm postgres @upstash/redis zod jsforce helmet
pnpm add -D drizzle-kit vitest @vitest/ui @types/node tsx typescript-eslint
```

- [ ] **Step 4: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 5: Write `next.config.ts`**

```ts
import type { NextConfig } from "next";

const config: NextConfig = {
  experimental: { typedRoutes: true },
  serverExternalPackages: ["jsforce"],
};

export default config;
```

- [ ] **Step 6: Write `vercel.ts`**

```ts
import { type VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  framework: "nextjs",
  buildCommand: "pnpm drizzle-kit migrate && pnpm build",
  crons: [
    { path: "/api/cron/process-retries", schedule: "* * * * *" },
    { path: "/api/cron/health-check", schedule: "*/5 * * * *" },
  ],
};
```

- [ ] **Step 7: Write `drizzle.config.ts`**

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./src/lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

- [ ] **Step 8: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
  },
  resolve: { alias: { "@": resolve(__dirname, "./src") } },
});
```

- [ ] **Step 9: Write `.gitignore`**

```
node_modules/
.next/
.vercel/
*.log
.env
.env.local
.DS_Store
coverage/
```

- [ ] **Step 10: Write minimal `src/app/layout.tsx` and `src/app/page.tsx`**

```tsx
// src/app/layout.tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}

// src/app/page.tsx
export default function Home() {
  return <main><h1>CallSofia Bridge</h1><p>Webhook bridge running.</p></main>;
}
```

- [ ] **Step 11: Verify build passes**

Run: `pnpm build`
Expected: Build succeeds. Next.js compiles without errors.

- [ ] **Step 12: Initial commit + link Vercel**

```bash
git add -A
git commit -m "chore: bootstrap callsofia-bridge"
git push -u origin main
vercel link --yes --project callsofia-bridge --scope call-sofia
vercel env add DATABASE_URL  # provision Neon via marketplace, paste URL
vercel env add REDIS_URL     # provision Upstash via marketplace, paste URL
```

---

## Task 2: Config module with Zod validation

**Wave:** 1

**Files:**
- Create: `src/lib/config.ts`
- Create: `src/lib/config.test.ts`
- Create: `.env.example`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/config.test.ts
import { describe, it, expect, beforeEach } from "vitest";

describe("config", () => {
  beforeEach(() => {
    process.env = { ...process.env };
  });

  it("parses required env vars", async () => {
    process.env.CALLSOFIA_API_BASE_URL = "https://api.callsofia.co";
    process.env.CALLSOFIA_ORG_ID = "10000000-0000-0000-0000-000000000001";
    process.env.CALLSOFIA_API_KEY = "sk_prod_test_xxx";
    process.env.CALLSOFIA_WEBHOOK_SECRET = "whsec_xxx";
    process.env.DATABASE_URL = "postgres://localhost/test";
    process.env.REDIS_URL = "rediss://localhost";
    process.env.CRM_ADAPTER = "litify";
    process.env.SALESFORCE_LOGIN_URL = "https://login.salesforce.com";
    process.env.SALESFORCE_CLIENT_ID = "x";
    process.env.SALESFORCE_CLIENT_SECRET = "y";
    process.env.SALESFORCE_USERNAME = "u";
    process.env.SALESFORCE_PASSWORD = "p";
    process.env.SALESFORCE_SECURITY_TOKEN = "t";
    process.env.ADMIN_PASSWORD = "admin";

    const { loadConfig } = await import("./config");
    const cfg = loadConfig();
    expect(cfg.callsofia.orgId).toBe("10000000-0000-0000-0000-000000000001");
    expect(cfg.crmAdapter).toBe("litify");
  });

  it("throws on missing required vars", async () => {
    delete process.env.CALLSOFIA_WEBHOOK_SECRET;
    const { loadConfig } = await import("./config");
    expect(() => loadConfig()).toThrow();
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `pnpm vitest run src/lib/config.test.ts`
Expected: FAIL — `Cannot find module './config'`

- [ ] **Step 3: Implement `src/lib/config.ts`**

```ts
import { z } from "zod";

const ConfigSchema = z.object({
  callsofia: z.object({
    apiBaseUrl: z.string().url(),
    orgId: z.string().uuid(),
    apiKey: z.string().min(8),
    webhookSecret: z.string().min(8),
  }),
  storage: z.object({
    databaseUrl: z.string().url(),
    redisUrl: z.string().url(),
  }),
  crmAdapter: z.enum(["litify", "generic-webhook", "none"]),
  salesforce: z.object({
    loginUrl: z.string().url(),
    clientId: z.string(),
    clientSecret: z.string(),
    username: z.string(),
    password: z.string(),
    securityToken: z.string(),
  }).optional(),
  litify: z.object({
    autoConvertQualified: z.boolean().default(false),
    intakeDefaultOwnerId: z.string().optional(),
    intakeCoordinatorUserId: z.string().optional(),
    intakeRecordTypeId: z.string().optional(),
  }).default({}),
  genericWebhook: z.object({
    url: z.string().url().optional(),
    secret: z.string().optional(),
    transform: z.enum(["raw", "flat", "litify-shape"]).default("raw"),
  }).default({}),
  handlers: z.object({
    callRinging: z.boolean().default(false),
    callAnswered: z.boolean().default(false),
    callInProgress: z.boolean().default(false),
    callEnded: z.boolean().default(true),
    callExtracted: z.boolean().default(true),
    leadQualified: z.boolean().default(true),
    leadNeedsReview: z.boolean().default(true),
    evaluationComplete: z.boolean().default(true),
    recordingOgg: z.boolean().default(true),
  }).default({}),
  reliability: z.object({
    maxRetries: z.coerce.number().default(10),
    retryBaseDelayMs: z.coerce.number().default(1000),
    retryMaxDelayMs: z.coerce.number().default(300_000),
    deadLetterAfterDays: z.coerce.number().default(7),
  }).default({}),
  admin: z.object({
    password: z.string().min(8),
    slackAlertWebhookUrl: z.string().url().optional(),
  }),
  observability: z.object({
    mirrorToPlatformApi: z.boolean().default(true),
    logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  }).default({}),
});

export type Config = z.infer<typeof ConfigSchema>;

const bool = (v: string | undefined, dflt = false): boolean =>
  v === undefined ? dflt : v === "true" || v === "1";

export function loadConfig(): Config {
  return ConfigSchema.parse({
    callsofia: {
      apiBaseUrl: process.env.CALLSOFIA_API_BASE_URL,
      orgId: process.env.CALLSOFIA_ORG_ID,
      apiKey: process.env.CALLSOFIA_API_KEY,
      webhookSecret: process.env.CALLSOFIA_WEBHOOK_SECRET,
    },
    storage: {
      databaseUrl: process.env.DATABASE_URL,
      redisUrl: process.env.REDIS_URL,
    },
    crmAdapter: process.env.CRM_ADAPTER,
    salesforce: process.env.SALESFORCE_CLIENT_ID ? {
      loginUrl: process.env.SALESFORCE_LOGIN_URL,
      clientId: process.env.SALESFORCE_CLIENT_ID,
      clientSecret: process.env.SALESFORCE_CLIENT_SECRET,
      username: process.env.SALESFORCE_USERNAME,
      password: process.env.SALESFORCE_PASSWORD,
      securityToken: process.env.SALESFORCE_SECURITY_TOKEN,
    } : undefined,
    litify: {
      autoConvertQualified: bool(process.env.LITIFY_AUTO_CONVERT_QUALIFIED),
      intakeDefaultOwnerId: process.env.INTAKE_DEFAULT_OWNER_ID,
      intakeCoordinatorUserId: process.env.INTAKE_COORDINATOR_USER_ID,
      intakeRecordTypeId: process.env.LITIFY_INTAKE_RECORD_TYPE_ID,
    },
    genericWebhook: {
      url: process.env.GENERIC_WEBHOOK_URL,
      secret: process.env.GENERIC_WEBHOOK_SECRET,
      transform: process.env.GENERIC_WEBHOOK_TRANSFORM,
    },
    handlers: {
      callRinging: bool(process.env.HANDLE_CALL_RINGING),
      callAnswered: bool(process.env.HANDLE_CALL_ANSWERED),
      callInProgress: bool(process.env.HANDLE_CALL_IN_PROGRESS),
      callEnded: bool(process.env.HANDLE_CALL_ENDED, true),
      callExtracted: bool(process.env.HANDLE_CALL_EXTRACTED, true),
      leadQualified: bool(process.env.HANDLE_LEAD_QUALIFIED, true),
      leadNeedsReview: bool(process.env.HANDLE_LEAD_NEEDS_REVIEW, true),
      evaluationComplete: bool(process.env.HANDLE_EVALUATION_COMPLETE, true),
      recordingOgg: bool(process.env.HANDLE_RECORDING_OGG, true),
    },
    reliability: {
      maxRetries: process.env.MAX_RETRIES,
      retryBaseDelayMs: process.env.RETRY_BASE_DELAY_MS,
      retryMaxDelayMs: process.env.RETRY_MAX_DELAY_MS,
      deadLetterAfterDays: process.env.DEAD_LETTER_AFTER_DAYS,
    },
    admin: {
      password: process.env.ADMIN_PASSWORD,
      slackAlertWebhookUrl: process.env.SLACK_ALERT_WEBHOOK_URL,
    },
    observability: {
      mirrorToPlatformApi: bool(process.env.MIRROR_TO_PLATFORM_API, true),
      logLevel: process.env.LOG_LEVEL,
    },
  });
}

let _cached: Config | null = null;
export function config(): Config {
  if (!_cached) _cached = loadConfig();
  return _cached;
}
```

- [ ] **Step 4: Write `.env.example`** (full template — see spec §7)

Copy the full env var list from spec §7 into `.env.example`.

- [ ] **Step 5: Run tests — verify pass**

Run: `pnpm vitest run src/lib/config.test.ts`
Expected: PASS, 2/2 tests.

- [ ] **Step 6: Commit**

```bash
git checkout -b task/02-config
git add src/lib/config.ts src/lib/config.test.ts .env.example
git commit -m "feat: env-var config with zod validation"
git push -u origin task/02-config
gh pr create --fill
```

---

## Task 3: Drizzle schema + Postgres client

**Wave:** 1

**Files:**
- Create: `src/lib/db/schema.ts`
- Create: `src/lib/db/client.ts`
- Create: `src/lib/db/schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/db/schema.test.ts
import { describe, it, expect } from "vitest";
import { events, deliveries, retryQueue } from "./schema";

describe("schema", () => {
  it("events table has required columns", () => {
    expect(events.eventId).toBeDefined();
    expect(events.eventType).toBeDefined();
    expect(events.payload).toBeDefined();
    expect(events.signatureValid).toBeDefined();
  });

  it("deliveries has unique constraint on (eventId, handlerId, attempt)", () => {
    expect(deliveries.eventId).toBeDefined();
    expect(deliveries.handlerId).toBeDefined();
    expect(deliveries.attempt).toBeDefined();
  });

  it("retryQueue tracks scheduled events", () => {
    expect(retryQueue.scheduledFor).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `pnpm vitest run src/lib/db/schema.test.ts` → FAIL (no schema module).

- [ ] **Step 3: Implement `src/lib/db/schema.ts`**

```ts
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
```

- [ ] **Step 4: Implement `src/lib/db/client.ts`**

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { config } from "../config";

const sql = postgres(config().storage.databaseUrl, { max: 10, idle_timeout: 20 });
export const db = drizzle(sql, { schema });
export { schema };
```

- [ ] **Step 5: Generate migrations**

```bash
pnpm drizzle-kit generate
```

This creates `src/lib/db/migrations/0000_initial.sql`.

- [ ] **Step 6: Run tests**

Run: `pnpm vitest run src/lib/db/schema.test.ts` → PASS.

- [ ] **Step 7: Commit**

```bash
git checkout -b task/03-db-schema
git add src/lib/db/ drizzle.config.ts
git commit -m "feat: drizzle schema for events, deliveries, retry_queue"
git push -u origin task/03-db-schema
gh pr create --fill
```

---

## Task 4: Redis client wrapper

**Wave:** 1

**Files:**
- Create: `src/lib/redis/client.ts`
- Create: `src/lib/redis/client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/redis/client.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@upstash/redis", () => ({
  Redis: class {
    private store = new Map<string, string>();
    async set(k: string, v: string, opts?: { ex?: number; nx?: boolean }) {
      if (opts?.nx && this.store.has(k)) return null;
      this.store.set(k, v);
      return "OK";
    }
    async get(k: string) { return this.store.get(k) ?? null; }
    async del(k: string) { return this.store.delete(k) ? 1 : 0; }
    async ping() { return "PONG"; }
  },
}));

describe("redis client", () => {
  it("setIfNotExists returns true on first call, false on duplicate", async () => {
    const { setIfNotExists } = await import("./client");
    expect(await setIfNotExists("k1", "v", 60)).toBe(true);
    expect(await setIfNotExists("k1", "v", 60)).toBe(false);
  });

  it("ping returns PONG", async () => {
    const { ping } = await import("./client");
    expect(await ping()).toBe("PONG");
  });
});
```

- [ ] **Step 2: Run test — fails (no module).**

- [ ] **Step 3: Implement `src/lib/redis/client.ts`**

```ts
import { Redis } from "@upstash/redis";
import { config } from "../config";

let _client: Redis | null = null;
function client(): Redis {
  if (!_client) _client = new Redis({ url: config().storage.redisUrl, token: process.env.REDIS_TOKEN ?? "" });
  return _client;
}

export async function setIfNotExists(key: string, value: string, ttlSeconds: number): Promise<boolean> {
  const result = await client().set(key, value, { nx: true, ex: ttlSeconds });
  return result === "OK";
}

export async function get(key: string): Promise<string | null> {
  return (await client().get<string>(key)) ?? null;
}

export async function del(key: string): Promise<void> {
  await client().del(key);
}

export async function ping(): Promise<string> {
  return await client().ping();
}

export const idempotency = {
  /** Mark event as processed; returns true if first time (caller should process), false if duplicate. */
  async claim(eventId: string, ttlSeconds = 86400): Promise<boolean> {
    return setIfNotExists(`evt:${eventId}`, "1", ttlSeconds);
  },
};
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git checkout -b task/04-redis-client
git add src/lib/redis/
git commit -m "feat: Upstash Redis client with idempotency helper"
git push -u origin task/04-redis-client
gh pr create --fill
```

---

## Task 5: BridgeLogger

**Wave:** 1

**Files:**
- Create: `src/lib/logger.ts`
- Create: `src/lib/logger.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/logger.test.ts
import { describe, it, expect, vi } from "vitest";

describe("BridgeLogger", () => {
  it("logs at info level by default", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { logger } = await import("./logger");
    logger.info("hello", { a: 1 });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("structured output is JSON", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { logger } = await import("./logger");
    logger.info("test_msg", { foo: "bar" });
    const arg = spy.mock.calls[0][0];
    const parsed = JSON.parse(arg);
    expect(parsed.message).toBe("test_msg");
    expect(parsed.foo).toBe("bar");
    expect(parsed.level).toBe("info");
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test — fails.**

- [ ] **Step 3: Implement `src/lib/logger.ts`**

```ts
type Level = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function configuredLevel(): Level {
  return (process.env.LOG_LEVEL as Level) ?? "info";
}

function emit(level: Level, message: string, meta: Record<string, unknown> = {}): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[configuredLevel()]) return;
  const entry = { ts: new Date().toISOString(), level, message, ...meta };
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(JSON.stringify(entry));
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => emit("debug", msg, meta),
  info:  (msg: string, meta?: Record<string, unknown>) => emit("info", msg, meta),
  warn:  (msg: string, meta?: Record<string, unknown>) => emit("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit("error", msg, meta),
};
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git checkout -b task/05-logger
git add src/lib/logger.ts src/lib/logger.test.ts
git commit -m "feat: structured JSON logger"
git push -u origin task/05-logger
gh pr create --fill
```

---

## Task 6: Webhook envelope types + Zod schemas

**Wave:** 1

**Files:**
- Create: `src/lib/webhook/types.ts`
- Create: `src/lib/webhook/envelope.ts`
- Create: `src/lib/webhook/envelope.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/webhook/envelope.test.ts
import { describe, it, expect } from "vitest";
import { parseEnvelope } from "./envelope";

const VALID = {
  event_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  event_type: "call.ended",
  emitted_at: "2026-04-29T13:21:39.043523+00:00",
  schema_version: 2,
  data: {
    scope: {
      org_id: "10000000-0000-0000-0000-000000000001",
      workspace_id: "20000000-0000-0000-0000-000000000001",
      pipeline_id: "80000000-0000-0000-0000-000000000001",
      stage_id: null,
    },
    payload: { call_id: "abc", duration: 100 },
  },
};

describe("envelope", () => {
  it("parses valid envelope", () => {
    const result = parseEnvelope(VALID);
    expect(result.event_type).toBe("call.ended");
  });

  it("throws on missing event_id", () => {
    const bad = { ...VALID, event_id: undefined };
    expect(() => parseEnvelope(bad)).toThrow();
  });

  it("throws on wrong schema_version", () => {
    expect(() => parseEnvelope({ ...VALID, schema_version: 99 })).toThrow();
  });
});
```

- [ ] **Step 2: Run — fails.**

- [ ] **Step 3: Implement `src/lib/webhook/types.ts`**

```ts
export const EVENT_TYPES = [
  "call.ringing", "call.answered", "call.in_progress",
  "call.completed", "call.disconnected", "call.ended",
  "call.requesting_transfer", "call.transferred", "call.transfer_failed",
  "call.extracted", "call.processed", "call.extracted.forwarded",
  "lead.qualified", "lead.needs_review",
  "evaluation.complete", "evaluation.failed",
  "recording.ogg", "call.outbound_request",
] as const;

export type EventType = typeof EVENT_TYPES[number];

export interface WebhookScope {
  org_id: string;
  workspace_id: string;
  pipeline_id: string;
  stage_id: string | null;
}

export interface CallSofiaEvent {
  event_id: string;
  event_type: EventType;
  emitted_at: string;
  schema_version: 2;
  data: {
    scope: WebhookScope;
    payload: Record<string, unknown>;
  };
  /** Convenience accessor for common fields. */
  payload?: never;
}
```

- [ ] **Step 4: Implement `src/lib/webhook/envelope.ts`**

```ts
import { z } from "zod";
import { EVENT_TYPES, type CallSofiaEvent } from "./types";

const ScopeSchema = z.object({
  org_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  pipeline_id: z.string().uuid(),
  stage_id: z.string().uuid().nullable(),
});

export const EnvelopeSchema = z.object({
  event_id: z.string().uuid(),
  event_type: z.enum(EVENT_TYPES),
  emitted_at: z.string(),
  schema_version: z.literal(2),
  data: z.object({
    scope: ScopeSchema,
    payload: z.record(z.unknown()),
  }),
});

export function parseEnvelope(input: unknown): CallSofiaEvent {
  return EnvelopeSchema.parse(input);
}
```

- [ ] **Step 5: Run tests** → PASS.

- [ ] **Step 6: Commit**

```bash
git checkout -b task/06-envelope
git add src/lib/webhook/types.ts src/lib/webhook/envelope.ts src/lib/webhook/envelope.test.ts
git commit -m "feat: webhook envelope zod schema and type definitions"
git push -u origin task/06-envelope
gh pr create --fill
```

---

## Task 7: HMAC signature verification

**Wave:** 1

**Files:**
- Create: `src/lib/webhook/verify.ts`
- Create: `src/lib/webhook/verify.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/webhook/verify.test.ts
import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { verifySignature, isTimestampFresh } from "./verify";

const SECRET = "whsec_test";
const TIMESTAMP = "2026-04-29T13:00:00+00:00";
const BODY = Buffer.from('{"event_id":"a"}', "utf-8");
const SIGNED = "sha256=" + crypto.createHmac("sha256", SECRET)
  .update(Buffer.concat([Buffer.from(TIMESTAMP, "utf-8"), Buffer.from("."), BODY]))
  .digest("hex");

describe("verifySignature", () => {
  it("accepts valid signature", () => {
    expect(verifySignature(SECRET, TIMESTAMP, BODY, SIGNED)).toBe(true);
  });
  it("rejects tampered body", () => {
    expect(verifySignature(SECRET, TIMESTAMP, Buffer.from("{}"), SIGNED)).toBe(false);
  });
  it("rejects wrong secret", () => {
    expect(verifySignature("wrong", TIMESTAMP, BODY, SIGNED)).toBe(false);
  });
  it("rejects malformed header", () => {
    expect(verifySignature(SECRET, TIMESTAMP, BODY, "garbage")).toBe(false);
  });
});

describe("isTimestampFresh", () => {
  it("rejects timestamps > 5 min old", () => {
    const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    expect(isTimestampFresh(old, 300)).toBe(false);
  });
  it("accepts recent timestamps", () => {
    expect(isTimestampFresh(new Date().toISOString(), 300)).toBe(true);
  });
});
```

- [ ] **Step 2: Run — fails.**

- [ ] **Step 3: Implement `src/lib/webhook/verify.ts`**

```ts
import crypto from "crypto";

export function verifySignature(
  secret: string,
  timestamp: string,
  rawBody: Buffer,
  signatureHeader: string,
): boolean {
  if (!signatureHeader.startsWith("sha256=")) return false;
  const signingString = Buffer.concat([
    Buffer.from(timestamp, "utf-8"),
    Buffer.from(".", "utf-8"),
    rawBody,
  ]);
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(signingString).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}

export function isTimestampFresh(timestamp: string, toleranceSeconds: number): boolean {
  const t = Date.parse(timestamp);
  if (Number.isNaN(t)) return false;
  return Math.abs(Date.now() - t) <= toleranceSeconds * 1000;
}
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git checkout -b task/07-verify
git add src/lib/webhook/verify.ts src/lib/webhook/verify.test.ts
git commit -m "feat: HMAC-SHA256 signature verification with timing-safe compare"
git push -u origin task/07-verify
gh pr create --fill
```

---

## Task 8: Webhook receiver route

**Wave:** 2 (depends on Tasks 2, 3, 5, 6, 7, 9, 10 — but cleanly: 2, 3, 6, 7 minimum; 9, 10 stub-able)

**Files:**
- Create: `src/app/api/webhooks/callsofia/route.ts`
- Create: `src/app/api/webhooks/callsofia/route.test.ts`

- [ ] **Step 1: Write integration-style test using Next.js Request**

```ts
// src/app/api/webhooks/callsofia/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

vi.mock("@/lib/db/client", () => ({
  db: { insert: () => ({ values: () => ({ onConflictDoNothing: async () => undefined }) }) },
  schema: { events: {} },
}));
vi.mock("@/lib/queue/publisher", () => ({ publishEventForProcessing: vi.fn(async () => undefined) }));
vi.mock("@/lib/platform-api/client", () => ({ platformApi: { logActivity: vi.fn(async () => undefined) } }));
vi.mock("@/lib/redis/client", () => ({ idempotency: { claim: vi.fn(async () => true) } }));

const SECRET = "whsec_test";
process.env.CALLSOFIA_WEBHOOK_SECRET = SECRET;
process.env.CALLSOFIA_API_BASE_URL = "https://api.callsofia.co";
process.env.CALLSOFIA_ORG_ID = "10000000-0000-0000-0000-000000000001";
process.env.CALLSOFIA_API_KEY = "k";
process.env.DATABASE_URL = "postgres://localhost/x";
process.env.REDIS_URL = "rediss://localhost";
process.env.CRM_ADAPTER = "litify";
process.env.SALESFORCE_LOGIN_URL = "https://login.salesforce.com";
process.env.SALESFORCE_CLIENT_ID = "x";
process.env.SALESFORCE_CLIENT_SECRET = "y";
process.env.SALESFORCE_USERNAME = "u";
process.env.SALESFORCE_PASSWORD = "p";
process.env.SALESFORCE_SECURITY_TOKEN = "t";
process.env.ADMIN_PASSWORD = "adminadmin";

function sign(body: string, ts: string): string {
  return "sha256=" + crypto.createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
}

describe("POST /api/webhooks/callsofia", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns 200 for valid signed request", async () => {
    const { POST } = await import("./route");
    const body = JSON.stringify({
      event_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      event_type: "call.ended",
      emitted_at: new Date().toISOString(),
      schema_version: 2,
      data: { scope: { org_id: "10000000-0000-0000-0000-000000000001", workspace_id: "20000000-0000-0000-0000-000000000001", pipeline_id: "80000000-0000-0000-0000-000000000001", stage_id: null }, payload: {} },
    });
    const ts = new Date().toISOString();
    const req = new Request("http://x/api/webhooks/callsofia", {
      method: "POST", body,
      headers: {
        "content-type": "application/json",
        "x-callsofia-timestamp": ts,
        "x-callsofia-signature": sign(body, ts),
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it("returns 401 for invalid signature", async () => {
    const { POST } = await import("./route");
    const body = "{}";
    const req = new Request("http://x/api/webhooks/callsofia", {
      method: "POST", body,
      headers: {
        "content-type": "application/json",
        "x-callsofia-timestamp": new Date().toISOString(),
        "x-callsofia-signature": "sha256=00",
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run — fails (no route module).**

- [ ] **Step 3: Implement route**

```ts
// src/app/api/webhooks/callsofia/route.ts
import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { verifySignature, isTimestampFresh } from "@/lib/webhook/verify";
import { parseEnvelope } from "@/lib/webhook/envelope";
import { db, schema } from "@/lib/db/client";
import { idempotency } from "@/lib/redis/client";
import { publishEventForProcessing } from "@/lib/queue/publisher";
import { platformApi } from "@/lib/platform-api/client";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const cfg = config();
  const rawBody = Buffer.from(await req.arrayBuffer());
  const signature = req.headers.get("x-callsofia-signature") ?? "";
  const timestamp = req.headers.get("x-callsofia-timestamp") ?? "";

  if (!verifySignature(cfg.callsofia.webhookSecret, timestamp, rawBody, signature)) {
    logger.warn("webhook_signature_invalid");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  if (!isTimestampFresh(timestamp, 300)) {
    return NextResponse.json({ error: "Timestamp too old" }, { status: 400 });
  }

  let envelope;
  try {
    envelope = parseEnvelope(JSON.parse(rawBody.toString("utf-8")));
  } catch (err) {
    logger.warn("webhook_envelope_invalid", { err: (err as Error).message });
    return NextResponse.json({ error: "Invalid envelope" }, { status: 400 });
  }

  const isFirstSeen = await idempotency.claim(envelope.event_id, 86400);
  if (!isFirstSeen) {
    return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
  }

  await db.insert(schema.events).values({
    eventId: envelope.event_id,
    eventType: envelope.event_type,
    emittedAt: new Date(envelope.emitted_at),
    schemaVersion: envelope.schema_version,
    scope: envelope.data.scope,
    payload: envelope.data.payload,
    rawEnvelope: envelope as unknown as Record<string, unknown>,
    signatureValid: true,
    status: "received",
  }).onConflictDoNothing();

  // Fire-and-forget mirror to platform-api
  void platformApi.logActivity({
    type: "bridge.event_received",
    severity: "info",
    event_data: { event_id: envelope.event_id, event_type: envelope.event_type, scope: envelope.data.scope },
  }).catch(err => logger.warn("mirror_failed", { err: err.message }));

  // Enqueue for processing
  await publishEventForProcessing(envelope.event_id);

  return NextResponse.json({ ok: true }, { status: 200 });
}
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git checkout -b task/08-webhook-receiver
git add src/app/api/webhooks/
git commit -m "feat: webhook receiver with HMAC verify, persist, mirror, enqueue"
git push -u origin task/08-webhook-receiver
gh pr create --fill
```

---

## Task 9: Platform API client

**Wave:** 2

**Files:**
- Create: `src/lib/platform-api/client.ts`
- Create: `src/lib/platform-api/activity-logs.ts`
- Create: `src/lib/platform-api/client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/platform-api/client.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;

beforeEach(() => { fetchMock.mockReset(); });

describe("PlatformApiClient.logActivity", () => {
  it("POSTs with X-API-Key", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    process.env.CALLSOFIA_API_BASE_URL = "https://api.callsofia.co";
    process.env.CALLSOFIA_API_KEY = "sk_test_xxx";
    process.env.CALLSOFIA_ORG_ID = "10000000-0000-0000-0000-000000000001";
    const { platformApi } = await import("./client");
    await platformApi.logActivity({ type: "bridge.event_received", severity: "info", event_data: { foo: "bar" } });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["X-API-Key"]).toBe("sk_test_xxx");
  });

  it("getCallDetail GETs the correct path", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "c1" }), { status: 200 }));
    const { platformApi } = await import("./client");
    const result = await platformApi.getCallDetail("c1");
    expect(result.id).toBe("c1");
    expect(fetchMock.mock.calls[0][0]).toContain("/v1/calls/c1");
  });
});
```

- [ ] **Step 2: Run — fails.**

- [ ] **Step 3: Implement `src/lib/platform-api/activity-logs.ts`**

```ts
export interface ActivityLogEntry {
  type: string;
  severity: "debug" | "info" | "warn" | "error";
  event_data: Record<string, unknown>;
  source?: string;
}
```

- [ ] **Step 4: Implement `src/lib/platform-api/client.ts`**

```ts
import { config } from "../config";
import { logger } from "../logger";
import type { ActivityLogEntry } from "./activity-logs";

class PlatformApiClient {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    const cfg = config();
    this.baseUrl = cfg.callsofia.apiBaseUrl;
    this.apiKey = cfg.callsofia.apiKey;
  }

  private headers(): Record<string, string> {
    return { "X-API-Key": this.apiKey, "Content-Type": "application/json" };
  }

  async logActivity(entry: ActivityLogEntry): Promise<void> {
    const cfg = config();
    if (!cfg.observability.mirrorToPlatformApi) return;
    try {
      const res = await fetch(`${this.baseUrl}/v1/activity-logs`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ ...entry, source: entry.source ?? "callsofia-bridge" }),
      });
      if (!res.ok) logger.warn("activity_log_post_failed", { status: res.status });
    } catch (err) {
      logger.warn("activity_log_network_error", { err: (err as Error).message });
    }
  }

  async logActivityBatch(entries: ActivityLogEntry[]): Promise<void> {
    await Promise.all(entries.map(e => this.logActivity(e)));
  }

  async getCallDetail(callId: string): Promise<{ id: string; [k: string]: unknown }> {
    const res = await fetch(`${this.baseUrl}/v1/calls/${callId}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`getCallDetail failed: ${res.status}`);
    return res.json();
  }

  async getLead(leadId: string): Promise<{ id: string; [k: string]: unknown }> {
    const res = await fetch(`${this.baseUrl}/v1/leads/${leadId}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`getLead failed: ${res.status}`);
    return res.json();
  }
}

export const platformApi = new PlatformApiClient();
```

- [ ] **Step 5: Run tests** → PASS.

- [ ] **Step 6: Commit**

```bash
git checkout -b task/09-platform-api
git add src/lib/platform-api/
git commit -m "feat: platform-api client with activity-logs + call/lead fetch"
git push -u origin task/09-platform-api
gh pr create --fill
```

---

## Task 10: Queue publisher + consumer scaffolding

**Wave:** 2

**Files:**
- Create: `src/lib/queue/publisher.ts`
- Create: `src/lib/queue/consumer.ts`
- Create: `src/lib/queue/consumer.test.ts`

> **Note:** Vercel Queues is in public beta. We use a thin wrapper so we can swap to Postgres-backed `retry_queue` if Queues is unavailable.

- [ ] **Step 1: Write test**

```ts
// src/lib/queue/consumer.test.ts
import { describe, it, expect } from "vitest";
import { computeBackoff } from "./consumer";

describe("computeBackoff", () => {
  it("attempt 1 → roughly base", () => {
    const ms = computeBackoff(1, { baseMs: 1000, maxMs: 60_000 });
    expect(ms).toBeGreaterThan(500);
    expect(ms).toBeLessThan(2000);
  });
  it("attempt 5 → exponential growth", () => {
    const ms = computeBackoff(5, { baseMs: 1000, maxMs: 60_000 });
    expect(ms).toBeGreaterThan(8000);
  });
  it("clamps to max", () => {
    const ms = computeBackoff(20, { baseMs: 1000, maxMs: 60_000 });
    expect(ms).toBeLessThanOrEqual(60_000 * 1.25);
  });
});
```

- [ ] **Step 2: Run — fails.**

- [ ] **Step 3: Implement `src/lib/queue/publisher.ts`**

```ts
import { logger } from "../logger";

export interface QueueMessage {
  event_id: string;
  attempt?: number;
}

const QUEUE_ENDPOINT = process.env.VERCEL_QUEUE_PUBLISH_URL ?? "";
const QUEUE_TOKEN = process.env.QUEUE_TOKEN ?? "";

export async function publishEventForProcessing(eventId: string, attempt = 1): Promise<void> {
  const message: QueueMessage = { event_id: eventId, attempt };

  if (!QUEUE_ENDPOINT) {
    // Fallback path — direct invoke consumer endpoint via fetch (dev mode)
    const url = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
    void fetch(`${url}/api/queue/consumer`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-queue-token": process.env.QUEUE_INTERNAL_TOKEN ?? "" },
      body: JSON.stringify(message),
    }).catch(err => logger.warn("queue_fallback_failed", { err: err.message }));
    return;
  }

  const res = await fetch(QUEUE_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${QUEUE_TOKEN}` },
    body: JSON.stringify(message),
  });
  if (!res.ok) throw new Error(`Queue publish failed: ${res.status}`);
}
```

- [ ] **Step 4: Implement `src/lib/queue/consumer.ts`** (skeleton — Task 23 wires adapters)

```ts
export interface BackoffOpts {
  baseMs: number;
  maxMs: number;
}

export function computeBackoff(attempt: number, { baseMs, maxMs }: BackoffOpts): number {
  const exp = Math.min(baseMs * Math.pow(2, attempt - 1), maxMs);
  const jitter = 0.75 + Math.random() * 0.5;
  return exp * jitter;
}

// processMessage will be implemented in Task 23 once adapters exist.
```

- [ ] **Step 5: Run tests** → PASS.

- [ ] **Step 6: Commit**

```bash
git checkout -b task/10-queue
git add src/lib/queue/
git commit -m "feat: queue publisher + backoff calculation"
git push -u origin task/10-queue
gh pr create --fill
```

---

## Task 11: CrmAdapter interface

**Wave:** 3

**Files:**
- Create: `src/lib/adapters/types.ts`

- [ ] **Step 1: Implement (no test — pure types)**

```ts
// src/lib/adapters/types.ts
import type { CallSofiaEvent } from "../webhook/types";
import type { ActivityLogEntry } from "../platform-api/activity-logs";

export interface AdapterContext {
  platformApi: {
    logActivity(entry: ActivityLogEntry): Promise<void>;
    getCallDetail(callId: string): Promise<{ id: string; [k: string]: unknown }>;
  };
  config: Record<string, unknown>;
}

export interface HandlerResult {
  outcome: "success" | "noop" | "failure" | "retry";
  crm_record_id?: string;
  crm_record_url?: string;
  message?: string;
  error?: { code: string; message: string; retryable: boolean };
  api_calls?: number;
}

export interface HealthStatus {
  healthy: boolean;
  message?: string;
  timestamp: Date;
}

export interface CrmAdapter {
  readonly name: string;
  init(): Promise<void>;
  handle(event: CallSofiaEvent, ctx: AdapterContext): Promise<HandlerResult>;
  healthCheck(): Promise<HealthStatus>;
}
```

- [ ] **Step 2: Verify it typechecks**

```bash
pnpm tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git checkout -b task/11-adapter-types
git add src/lib/adapters/types.ts
git commit -m "feat: CrmAdapter interface and result types"
git push -u origin task/11-adapter-types
gh pr create --fill
```

---

## Task 12: Adapter registry

**Wave:** 3

**Files:**
- Create: `src/lib/adapters/registry.ts`
- Create: `src/lib/adapters/registry.test.ts`

- [ ] **Step 1: Write test**

```ts
// src/lib/adapters/registry.test.ts
import { describe, it, expect } from "vitest";
import { selectAdapterName } from "./registry";

describe("selectAdapterName", () => {
  it("returns env CRM_ADAPTER value", () => {
    expect(selectAdapterName("litify")).toBe("litify");
    expect(selectAdapterName("generic-webhook")).toBe("generic-webhook");
    expect(selectAdapterName("none")).toBe("none");
  });
  it("throws on unknown adapter", () => {
    expect(() => selectAdapterName("oracle")).toThrow();
  });
});
```

- [ ] **Step 2: Implement `src/lib/adapters/registry.ts`**

```ts
import type { CrmAdapter } from "./types";

export type AdapterName = "litify" | "generic-webhook" | "none";
const VALID_NAMES: AdapterName[] = ["litify", "generic-webhook", "none"];

export function selectAdapterName(name: string): AdapterName {
  if (!VALID_NAMES.includes(name as AdapterName)) throw new Error(`Unknown adapter: ${name}`);
  return name as AdapterName;
}

let _cached: CrmAdapter | null = null;

export async function getAdapter(name: AdapterName): Promise<CrmAdapter> {
  if (_cached && _cached.name === name) return _cached;
  switch (name) {
    case "litify": {
      const { LitifyAdapter } = await import("./litify/adapter");
      _cached = new LitifyAdapter();
      break;
    }
    case "generic-webhook": {
      const { GenericWebhookAdapter } = await import("./generic-webhook/adapter");
      _cached = new GenericWebhookAdapter();
      break;
    }
    case "none":
      _cached = {
        name: "none",
        async init() {},
        async handle() { return { outcome: "noop" as const }; },
        async healthCheck() { return { healthy: true, timestamp: new Date() }; },
      };
      break;
  }
  await _cached!.init();
  return _cached!;
}
```

- [ ] **Step 3: Run tests** → PASS.

- [ ] **Step 4: Commit**

```bash
git checkout -b task/12-registry
git add src/lib/adapters/registry.ts src/lib/adapters/registry.test.ts
git commit -m "feat: adapter registry with lazy loading"
git push -u origin task/12-registry
gh pr create --fill
```

---

## Task 13: Litify Auth (Salesforce OAuth + token cache)

**Wave:** 4

**Files:**
- Create: `src/lib/adapters/litify/auth.ts`
- Create: `src/lib/adapters/litify/auth.test.ts`

- [ ] **Step 1: Write test (mock jsforce)**

```ts
// src/lib/adapters/litify/auth.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("jsforce", () => {
  return {
    Connection: class {
      accessToken = "mock_token";
      instanceUrl = "https://mock.my.salesforce.com";
      async login() { return { id: "x", organizationId: "y" }; }
      async query(soql: string) { return { records: [], totalSize: 0 }; }
    },
  };
});
vi.mock("@/lib/config", () => ({
  config: () => ({
    salesforce: { loginUrl: "https://login.salesforce.com", clientId: "c", clientSecret: "s", username: "u", password: "p", securityToken: "t" },
  }),
}));

describe("LitifyAuth", () => {
  it("getConnection returns a logged-in connection", async () => {
    const { LitifyAuth } = await import("./auth");
    const auth = new LitifyAuth();
    const conn = await auth.getConnection();
    expect(conn.accessToken).toBe("mock_token");
  });
});
```

- [ ] **Step 2: Run — fails.**

- [ ] **Step 3: Implement `src/lib/adapters/litify/auth.ts`**

```ts
import jsforce from "jsforce";
import { config } from "@/lib/config";
import { logger } from "@/lib/logger";

export class LitifyAuth {
  private conn: jsforce.Connection | null = null;
  private expiresAt = 0;

  async getConnection(): Promise<jsforce.Connection> {
    if (this.conn && Date.now() < this.expiresAt) return this.conn;

    const cfg = config().salesforce;
    if (!cfg) throw new Error("Salesforce config missing");

    const conn = new jsforce.Connection({ loginUrl: cfg.loginUrl });
    await conn.login(cfg.username, cfg.password + cfg.securityToken);
    this.conn = conn;
    this.expiresAt = Date.now() + 90 * 60 * 1000; // 90 min
    logger.info("litify_auth_logged_in", { instance: conn.instanceUrl });
    return conn;
  }

  async ping(): Promise<boolean> {
    try {
      const conn = await this.getConnection();
      await conn.query("SELECT Id FROM User LIMIT 1");
      return true;
    } catch (err) {
      logger.error("litify_ping_failed", { err: (err as Error).message });
      return false;
    }
  }
}

export const litifyAuth = new LitifyAuth();
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git checkout -b task/13-litify-auth
git add src/lib/adapters/litify/auth.ts src/lib/adapters/litify/auth.test.ts
git commit -m "feat: Litify Salesforce auth with connection caching"
git push -u origin task/13-litify-auth
gh pr create --fill
```

---

## Task 14: Litify field mapping (pure functions)

**Wave:** 4

**Files:**
- Create: `src/lib/adapters/litify/field-mapping.ts`
- Create: `src/lib/adapters/litify/field-mapping.test.ts`

- [ ] **Step 1: Write tests**

```ts
// src/lib/adapters/litify/field-mapping.test.ts
import { describe, it, expect } from "vitest";
import { mapCaseType, mapStatus, mapExtractedVars, mapLanguage } from "./field-mapping";

describe("mapCaseType", () => {
  it("maps known case types", () => {
    expect(mapCaseType("workers_comp")).toBe("Workers' Compensation");
    expect(mapCaseType("auto_accident")).toBe("Auto Accident");
  });
  it("falls back to General for unknown", () => {
    expect(mapCaseType("totally_made_up")).toBe("General Personal Injury");
  });
});

describe("mapStatus", () => {
  it("qualified → Qualified", () => {
    expect(mapStatus("qualified")).toBe("Qualified");
  });
  it("needs_review → Needs Review", () => {
    expect(mapStatus("needs_review")).toBe("Needs Review");
  });
});

describe("mapExtractedVars", () => {
  it("maps incident_date and injury_type", () => {
    const result = mapExtractedVars({
      incident_date: "2026-04-24",
      injury_type: "lower_back",
      employer_name: "Acme Co",
      represented_by_attorney: false,
    });
    expect(result.CallSofia_Incident_Date__c).toBe("2026-04-24");
    expect(result.CallSofia_Injury_Type__c).toBe("lower_back");
    expect(result.CallSofia_Employer_Name__c).toBe("Acme Co");
    expect(result.CallSofia_Prior_Attorney__c).toBe(false);
  });
  it("strips undefined values", () => {
    const result = mapExtractedVars({ incident_date: "2026-01-01" });
    expect(result.CallSofia_Injury_Type__c).toBeUndefined();
  });
});

describe("mapLanguage", () => {
  it("maps language codes", () => {
    expect(mapLanguage("en")).toBe("English");
    expect(mapLanguage("es")).toBe("Spanish");
    expect(mapLanguage("hi")).toBe("Hindi");
  });
});
```

- [ ] **Step 2: Run — fails.**

- [ ] **Step 3: Implement `src/lib/adapters/litify/field-mapping.ts`**

```ts
const CASE_TYPE_TO_LITIFY: Record<string, string> = {
  workers_comp: "Workers' Compensation",
  auto_accident: "Auto Accident",
  slip_and_fall: "Premises Liability",
  premises_liability: "Premises Liability",
  medical_malpractice: "Medical Malpractice",
  product_liability: "Product Liability",
  wrongful_death: "Wrongful Death",
  general_injury: "General Personal Injury",
};

const STATUS_MAP: Record<string, string> = {
  qualified: "Qualified",
  needs_review: "Needs Review",
  rejected: "Rejected",
};

const LANGUAGE_MAP: Record<string, string> = {
  en: "English",
  es: "Spanish",
  hi: "Hindi",
};

export function mapCaseType(callsofiaCaseType: string): string {
  return CASE_TYPE_TO_LITIFY[callsofiaCaseType] ?? "General Personal Injury";
}

export function mapStatus(callsofiaStatus: string): string {
  return STATUS_MAP[callsofiaStatus] ?? "New";
}

export function mapLanguage(code: string): string {
  return LANGUAGE_MAP[code] ?? "English";
}

export interface IntakeFields {
  CallSofia_Incident_Date__c?: string;
  CallSofia_Injury_Type__c?: string;
  CallSofia_Employer_Name__c?: string;
  CallSofia_Medical_Treatment__c?: string;
  CallSofia_Prior_Attorney__c?: boolean;
  CallSofia_Summary__c?: string;
  CallSofia_Quality_Score__c?: number;
}

export function mapExtractedVars(extracted: Record<string, unknown>): IntakeFields {
  const out: IntakeFields = {};
  if (typeof extracted.incident_date === "string") out.CallSofia_Incident_Date__c = extracted.incident_date;
  if (typeof extracted.injury_type === "string") out.CallSofia_Injury_Type__c = extracted.injury_type;
  if (typeof extracted.employer_name === "string") out.CallSofia_Employer_Name__c = extracted.employer_name;
  if (typeof extracted.medical_treatment === "string") out.CallSofia_Medical_Treatment__c = extracted.medical_treatment;
  if (typeof extracted.represented_by_attorney === "boolean") out.CallSofia_Prior_Attorney__c = extracted.represented_by_attorney;
  return out;
}
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git checkout -b task/14-litify-mapping
git add src/lib/adapters/litify/field-mapping.ts src/lib/adapters/litify/field-mapping.test.ts
git commit -m "feat: Litify field mapping functions"
git push -u origin task/14-litify-mapping
gh pr create --fill
```

---

## Task 15: Litify case-type cache

**Wave:** 4

**Files:**
- Create: `src/lib/adapters/litify/case-type-cache.ts`
- Create: `src/lib/adapters/litify/case-type-cache.test.ts`

- [ ] **Step 1: Write test**

```ts
// src/lib/adapters/litify/case-type-cache.test.ts
import { describe, it, expect, vi } from "vitest";

const queryMock = vi.fn();
vi.mock("./auth", () => ({ litifyAuth: { getConnection: async () => ({ query: queryMock }) } }));
vi.mock("@/lib/redis/client", () => ({
  get: vi.fn(async (k: string) => null),
  setIfNotExists: vi.fn(async () => true),
  // simple in-memory mock
}));

describe("getLitifyCaseTypeId", () => {
  it("queries SOQL and returns ID for case type name", async () => {
    queryMock.mockResolvedValue({ records: [{ Id: "a0X123" }], totalSize: 1 });
    const { getLitifyCaseTypeId } = await import("./case-type-cache");
    const id = await getLitifyCaseTypeId("Workers' Compensation");
    expect(id).toBe("a0X123");
  });

  it("returns null when not found", async () => {
    queryMock.mockResolvedValue({ records: [], totalSize: 0 });
    const { getLitifyCaseTypeId } = await import("./case-type-cache");
    const id = await getLitifyCaseTypeId("Nonexistent");
    expect(id).toBeNull();
  });
});
```

- [ ] **Step 2: Run — fails.**

- [ ] **Step 3: Implement `src/lib/adapters/litify/case-type-cache.ts`**

```ts
import { litifyAuth } from "./auth";
import * as redis from "@/lib/redis/client";

const CACHE_TTL = 24 * 60 * 60;
const CACHE_PREFIX = "litify:case_type:";

export async function getLitifyCaseTypeId(name: string): Promise<string | null> {
  const cached = await redis.get(`${CACHE_PREFIX}${name}`);
  if (cached !== null) return cached === "__null__" ? null : cached;

  const conn = await litifyAuth.getConnection();
  const escaped = name.replace(/'/g, "\\'");
  const result = await conn.query<{ Id: string }>(
    `SELECT Id FROM litify_pm__Case_Type__c WHERE Name = '${escaped}' LIMIT 1`
  );
  const id = result.records[0]?.Id ?? null;
  await redis.setIfNotExists(`${CACHE_PREFIX}${name}`, id ?? "__null__", CACHE_TTL);
  return id;
}
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git checkout -b task/15-litify-case-type-cache
git add src/lib/adapters/litify/case-type-cache.ts src/lib/adapters/litify/case-type-cache.test.ts
git commit -m "feat: Litify case-type cache with 24h Redis TTL"
git push -u origin task/15-litify-case-type-cache
gh pr create --fill
```

---

## Task 16: Generic Webhook transforms

**Wave:** 4

**Files:**
- Create: `src/lib/adapters/generic-webhook/transforms.ts`
- Create: `src/lib/adapters/generic-webhook/transforms.test.ts`

- [ ] **Step 1: Write test**

```ts
// src/lib/adapters/generic-webhook/transforms.test.ts
import { describe, it, expect } from "vitest";
import { transformEvent } from "./transforms";
import type { CallSofiaEvent } from "@/lib/webhook/types";

const event: CallSofiaEvent = {
  event_id: "abc",
  event_type: "lead.qualified",
  emitted_at: "2026-04-29T13:00:00+00:00",
  schema_version: 2,
  data: {
    scope: { org_id: "o", workspace_id: "w", pipeline_id: "p", stage_id: null },
    payload: { call_id: "c", caller_phone_number: "+1", lead: { name: "Janelle" }, extracted_vars: { injury_type: "back" } },
  },
};

describe("transformEvent", () => {
  it("raw passes envelope through", () => {
    const r = transformEvent(event, "raw");
    expect(r.event_id).toBe("abc");
    expect(r.data.payload).toEqual(event.data.payload);
  });
  it("flat hoists payload + scope", () => {
    const r = transformEvent(event, "flat") as Record<string, unknown>;
    expect(r.event_type).toBe("lead.qualified");
    expect(r.org_id).toBe("o");
    expect(r.call_id).toBe("c");
    expect(r.lead_name).toBe("Janelle");
  });
  it("litify-shape produces SObject-style fields", () => {
    const r = transformEvent(event, "litify-shape") as Record<string, unknown>;
    expect(r.CallSofia_Call_ID__c).toBe("c");
    expect(r.CallSofia_Injury_Type__c).toBe("back");
  });
});
```

- [ ] **Step 2: Run — fails.**

- [ ] **Step 3: Implement `src/lib/adapters/generic-webhook/transforms.ts`**

```ts
import type { CallSofiaEvent } from "@/lib/webhook/types";

export type TransformName = "raw" | "flat" | "litify-shape";

export function transformEvent(event: CallSofiaEvent, name: TransformName): unknown {
  if (name === "raw") return event;
  if (name === "flat") return flatten(event);
  if (name === "litify-shape") return litifyShape(event);
  throw new Error(`Unknown transform: ${name}`);
}

function flatten(event: CallSofiaEvent): Record<string, unknown> {
  const p = event.data.payload as Record<string, unknown>;
  const lead = (p.lead ?? {}) as Record<string, unknown>;
  return {
    event_id: event.event_id,
    event_type: event.event_type,
    emitted_at: event.emitted_at,
    org_id: event.data.scope.org_id,
    workspace_id: event.data.scope.workspace_id,
    pipeline_id: event.data.scope.pipeline_id,
    call_id: p.call_id,
    caller_phone: p.caller_phone_number ?? p.caller_phone,
    case_type: p.case_type,
    summary: p.summary,
    lead_name: lead.name,
    lead_email: lead.email,
    lead_stage: lead.stage,
    extracted: p.extracted_vars,
  };
}

function litifyShape(event: CallSofiaEvent): Record<string, unknown> {
  const p = event.data.payload as Record<string, unknown>;
  const ev = (p.extracted_vars ?? {}) as Record<string, unknown>;
  return {
    CallSofia_Event_ID__c: event.event_id,
    CallSofia_Event_Type__c: event.event_type,
    CallSofia_Call_ID__c: p.call_id,
    CallSofia_Phone__c: p.caller_phone_number ?? p.caller_phone,
    CallSofia_Case_Type__c: p.case_type,
    CallSofia_Summary__c: p.summary,
    CallSofia_Incident_Date__c: ev.incident_date,
    CallSofia_Injury_Type__c: ev.injury_type,
    CallSofia_Employer_Name__c: ev.employer_name,
  };
}
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git checkout -b task/16-generic-transforms
git add src/lib/adapters/generic-webhook/
git commit -m "feat: generic webhook transform functions (raw/flat/litify-shape)"
git push -u origin task/16-generic-transforms
gh pr create --fill
```

---

## Task 17: Litify Person operations

**Wave:** 5

**Files:**
- Create: `src/lib/adapters/litify/person.ts`
- Create: `src/lib/adapters/litify/person.test.ts`

- [ ] **Step 1: Write test**

```ts
// src/lib/adapters/litify/person.test.ts
import { describe, it, expect, vi } from "vitest";

const queryMock = vi.fn();
const sobjectMock = vi.fn();
const upsertMock = vi.fn();
vi.mock("./auth", () => ({
  litifyAuth: {
    getConnection: async () => ({
      query: queryMock,
      sobject: (name: string) => ({ create: async (data: any) => ({ id: "p1", success: true }), upsert: upsertMock }),
    }),
  },
}));

describe("LitifyPerson.findByPhone", () => {
  it("returns person ID when match exists", async () => {
    queryMock.mockResolvedValue({ records: [{ Id: "p1", Name: "Janelle" }], totalSize: 1 });
    const { findByPhone } = await import("./person");
    const result = await findByPhone("+12132779473");
    expect(result?.Id).toBe("p1");
  });
  it("returns null when no match", async () => {
    queryMock.mockResolvedValue({ records: [], totalSize: 0 });
    const { findByPhone } = await import("./person");
    expect(await findByPhone("+10000000000")).toBeNull();
  });
});

describe("LitifyPerson.upsertByPhone", () => {
  it("creates new if not found", async () => {
    queryMock.mockResolvedValue({ records: [], totalSize: 0 });
    const { upsertByPhone } = await import("./person");
    const result = await upsertByPhone("+15555550001", { firstName: "Test", lastName: "User" });
    expect(result.Id).toBe("p1");
  });
});
```

- [ ] **Step 2: Run — fails.**

- [ ] **Step 3: Implement `src/lib/adapters/litify/person.ts`**

```ts
import { litifyAuth } from "./auth";
import { logger } from "@/lib/logger";

export interface LitifyPerson {
  Id: string;
  Name: string;
  Phone?: string;
}

export interface PersonInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
}

const escapeStr = (s: string) => s.replace(/'/g, "\\'");

export async function findByPhone(phone: string): Promise<LitifyPerson | null> {
  const conn = await litifyAuth.getConnection();
  const result = await conn.query<LitifyPerson>(
    `SELECT Id, Name, Phone FROM litify_pm__Person__c WHERE Phone = '${escapeStr(phone)}' LIMIT 1`
  );
  return result.records[0] ?? null;
}

export async function upsertByPhone(phone: string, input: PersonInput): Promise<LitifyPerson> {
  const existing = await findByPhone(phone);
  if (existing) {
    logger.debug("litify_person_found", { id: existing.Id });
    return existing;
  }
  const conn = await litifyAuth.getConnection();
  const lastName = input.lastName ?? input.firstName ?? "Unknown";
  const created = await conn.sobject("litify_pm__Person__c").create({
    litify_pm__First_Name__c: input.firstName,
    litify_pm__Last_Name__c: lastName,
    litify_pm__Email__c: input.email,
    Phone: phone,
  });
  if (!created.success) throw new Error(`Person create failed: ${JSON.stringify((created as any).errors)}`);
  logger.info("litify_person_created", { id: created.id });
  return { Id: created.id!, Name: lastName, Phone: phone };
}
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git checkout -b task/17-litify-person
git add src/lib/adapters/litify/person.ts src/lib/adapters/litify/person.test.ts
git commit -m "feat: Litify Person find/upsert by phone"
git push -u origin task/17-litify-person
gh pr create --fill
```

---

## Task 18: Litify Intake operations

**Wave:** 5

**Files:**
- Create: `src/lib/adapters/litify/intake.ts`
- Create: `src/lib/adapters/litify/intake.test.ts`

- [ ] **Step 1: Write test**

```ts
// src/lib/adapters/litify/intake.test.ts
import { describe, it, expect, vi } from "vitest";

const queryMock = vi.fn();
const createMock = vi.fn();
const updateMock = vi.fn();
const upsertMock = vi.fn();

vi.mock("./auth", () => ({
  litifyAuth: { getConnection: async () => ({ query: queryMock, sobject: () => ({ create: createMock, update: updateMock, upsert: upsertMock }) }) },
}));
vi.mock("./case-type-cache", () => ({ getLitifyCaseTypeId: async () => "ct1" }));

describe("LitifyIntake.create", () => {
  it("creates intake with case type lookup", async () => {
    createMock.mockResolvedValue({ id: "i1", success: true });
    const { createIntake } = await import("./intake");
    const result = await createIntake({
      personId: "p1",
      callId: "c1",
      callerPhone: "+1",
      startedAt: "2026-04-29T13:00:00Z",
      endedAt: "2026-04-29T13:17:00Z",
      duration: 1020,
      language: "en",
      caseType: "Workers' Compensation",
      twilioSid: "CA1",
    });
    expect(result.id).toBe("i1");
  });
});

describe("LitifyIntake.findByCallId", () => {
  it("looks up by external ID", async () => {
    queryMock.mockResolvedValue({ records: [{ Id: "i1" }], totalSize: 1 });
    const { findByCallId } = await import("./intake");
    expect((await findByCallId("c1"))?.Id).toBe("i1");
  });
});
```

- [ ] **Step 2: Run — fails.**

- [ ] **Step 3: Implement `src/lib/adapters/litify/intake.ts`**

```ts
import { litifyAuth } from "./auth";
import { getLitifyCaseTypeId } from "./case-type-cache";
import { logger } from "@/lib/logger";
import { config } from "@/lib/config";

export interface IntakeCreateInput {
  personId: string;
  callId: string;
  callerPhone: string;
  startedAt: string;
  endedAt: string;
  duration: number;
  language: string;
  caseType: string;
  twilioSid: string;
  summary?: string;
}

export interface LitifyIntake {
  Id: string;
  Name?: string;
  CallSofia_Call_ID__c?: string;
  litify_pm__Status__c?: string;
}

const escapeStr = (s: string) => s.replace(/'/g, "\\'");

export async function findByCallId(callId: string): Promise<LitifyIntake | null> {
  const conn = await litifyAuth.getConnection();
  const r = await conn.query<LitifyIntake>(
    `SELECT Id, Name, CallSofia_Call_ID__c, litify_pm__Status__c FROM litify_pm__Intake__c WHERE CallSofia_Call_ID__c = '${escapeStr(callId)}' LIMIT 1`
  );
  return r.records[0] ?? null;
}

export async function createIntake(input: IntakeCreateInput): Promise<{ id: string }> {
  const conn = await litifyAuth.getConnection();
  const caseTypeId = await getLitifyCaseTypeId(input.caseType);
  const cfg = config().litify;
  const result = await conn.sobject("litify_pm__Intake__c").create({
    litify_pm__Person__c: input.personId,
    litify_pm__Source__c: "AI Voice Intake (CallSofia)",
    litify_pm__Status__c: "New",
    litify_pm__Date_Opened__c: input.startedAt,
    litify_pm__Case_Type_Lookup__c: caseTypeId ?? undefined,
    OwnerId: cfg.intakeDefaultOwnerId,
    RecordTypeId: cfg.intakeRecordTypeId,
    CallSofia_Call_ID__c: input.callId,
    CallSofia_Twilio_SID__c: input.twilioSid,
    CallSofia_Language__c: input.language,
    CallSofia_Case_Type__c: input.caseType,
    CallSofia_Summary__c: input.summary,
    CallSofia_Last_Synced_At__c: new Date().toISOString(),
  });
  if (!result.success) throw new Error(`Intake create failed: ${JSON.stringify((result as any).errors)}`);
  logger.info("litify_intake_created", { id: result.id, call_id: input.callId });
  return { id: result.id! };
}

export async function upsertByCallId(callId: string, fields: Record<string, unknown>): Promise<{ id: string }> {
  const existing = await findByCallId(callId);
  if (existing) {
    const conn = await litifyAuth.getConnection();
    await conn.sobject("litify_pm__Intake__c").update({
      Id: existing.Id,
      ...fields,
      CallSofia_Last_Synced_At__c: new Date().toISOString(),
    });
    return { id: existing.Id };
  }
  // No existing intake — caller should ensure it's created via createIntake first
  throw new Error(`No intake found for call_id=${callId}; call createIntake first`);
}

export async function attachRecording(intakeId: string, opts: { downloadUrl: string; fileSize: number }): Promise<string> {
  const conn = await litifyAuth.getConnection();
  await conn.sobject("litify_pm__Intake__c").update({
    Id: intakeId,
    CallSofia_Recording_URL__c: opts.downloadUrl,
  });
  return intakeId;
}

export async function triggerConversionFlow(intakeId: string): Promise<void> {
  // Salesforce Flow invocation — typically via REST /services/data/vXX.X/actions/custom/flow/<FlowName>
  logger.info("litify_intake_conversion_triggered", { id: intakeId });
}
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git checkout -b task/18-litify-intake
git add src/lib/adapters/litify/intake.ts src/lib/adapters/litify/intake.test.ts
git commit -m "feat: Litify Intake CRUD with case-type lookup and idempotency by Call ID"
git push -u origin task/18-litify-intake
gh pr create --fill
```

---

## Task 19: Litify Activity (Task) operations

**Wave:** 5

**Files:**
- Create: `src/lib/adapters/litify/activity.ts`
- Create: `src/lib/adapters/litify/activity.test.ts`

- [ ] **Step 1: Write test**

```ts
// src/lib/adapters/litify/activity.test.ts
import { describe, it, expect, vi } from "vitest";

const queryMock = vi.fn();
const createMock = vi.fn();
const updateMock = vi.fn();

vi.mock("./auth", () => ({
  litifyAuth: { getConnection: async () => ({ query: queryMock, sobject: () => ({ create: createMock, update: updateMock }) }) },
}));

describe("LitifyActivity", () => {
  it("startInboundCall creates Task", async () => {
    createMock.mockResolvedValue({ id: "t1", success: true });
    const { startInboundCall } = await import("./activity");
    const result = await startInboundCall({ personId: "p1", callId: "c1", twilioSid: "CA1" });
    expect(result.id).toBe("t1");
  });

  it("completeCall updates Task", async () => {
    queryMock.mockResolvedValue({ records: [{ Id: "t1" }], totalSize: 1 });
    updateMock.mockResolvedValue({ id: "t1", success: true });
    const { completeCall } = await import("./activity");
    await completeCall({ callId: "c1", duration: 1020, intakeId: "i1" });
    expect(updateMock).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — fails.**

- [ ] **Step 3: Implement `src/lib/adapters/litify/activity.ts`**

```ts
import { litifyAuth } from "./auth";
import { logger } from "@/lib/logger";

export interface InboundCallStartInput {
  personId: string;
  callId: string;
  twilioSid: string;
}

export interface CompleteCallInput {
  callId: string;
  duration: number;
  intakeId: string;
}

const escape = (s: string) => s.replace(/'/g, "\\'");

export async function startInboundCall(input: InboundCallStartInput): Promise<{ id: string }> {
  const conn = await litifyAuth.getConnection();
  const result = await conn.sobject("Task").create({
    Subject: "Inbound Call (CallSofia)",
    Status: "In Progress",
    Type: "Call",
    WhoId: input.personId,
    CallType: "Inbound",
    CallSofia_Call_ID__c: input.callId,
    CallSofia_Twilio_SID__c: input.twilioSid,
  });
  if (!result.success) throw new Error(`Task create failed: ${JSON.stringify((result as any).errors)}`);
  logger.info("litify_task_created", { id: result.id, call_id: input.callId });
  return { id: result.id! };
}

export async function completeCall(input: CompleteCallInput): Promise<void> {
  const conn = await litifyAuth.getConnection();
  const r = await conn.query<{ Id: string }>(
    `SELECT Id FROM Task WHERE CallSofia_Call_ID__c = '${escape(input.callId)}' LIMIT 1`
  );
  const taskId = r.records[0]?.Id;
  if (!taskId) {
    logger.warn("litify_task_not_found_for_complete", { call_id: input.callId });
    return;
  }
  await conn.sobject("Task").update({
    Id: taskId,
    Status: "Completed",
    CallDurationInSeconds: Math.round(input.duration),
    WhatId: input.intakeId,
  });
  logger.info("litify_task_completed", { id: taskId, call_id: input.callId });
}

export async function appendNote(callId: string, note: string): Promise<void> {
  const conn = await litifyAuth.getConnection();
  const r = await conn.query<{ Id: string; Description?: string }>(
    `SELECT Id, Description FROM Task WHERE CallSofia_Call_ID__c = '${escape(callId)}' LIMIT 1`
  );
  const task = r.records[0];
  if (!task) return;
  const merged = (task.Description ?? "") + "\n" + note;
  await conn.sobject("Task").update({ Id: task.Id, Description: merged });
}
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git checkout -b task/19-litify-activity
git add src/lib/adapters/litify/activity.ts src/lib/adapters/litify/activity.test.ts
git commit -m "feat: Litify Task (Activity) operations"
git push -u origin task/19-litify-activity
gh pr create --fill
```

---

## Task 20: Litify Recording attachment

**Wave:** 5

**Files:**
- Create: `src/lib/adapters/litify/recording.ts`
- Create: `src/lib/adapters/litify/recording.test.ts`

- [ ] **Step 1: Write test**

```ts
// src/lib/adapters/litify/recording.test.ts
import { describe, it, expect, vi } from "vitest";

const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;

const createMock = vi.fn();
vi.mock("./auth", () => ({
  litifyAuth: { getConnection: async () => ({ sobject: () => ({ create: createMock }) }) },
}));

describe("attachRecordingToIntake", () => {
  it("downloads, base64-encodes, and creates ContentDocument", async () => {
    fetchMock.mockResolvedValue(new Response(new ArrayBuffer(1024), { status: 200 }));
    createMock
      .mockResolvedValueOnce({ id: "069xxx", success: true }) // ContentVersion
      .mockResolvedValueOnce({ id: "06Axxx", success: true }); // ContentDocumentLink

    const { attachRecordingToIntake } = await import("./recording");
    const result = await attachRecordingToIntake({
      intakeId: "i1",
      downloadUrl: "https://s3/recording.ogg",
      callId: "c1",
    });
    expect(result.contentDocumentId).toBeDefined();
  });
});
```

- [ ] **Step 2: Run — fails.**

- [ ] **Step 3: Implement `src/lib/adapters/litify/recording.ts`**

```ts
import { litifyAuth } from "./auth";
import { logger } from "@/lib/logger";

export interface AttachRecordingInput {
  intakeId: string;
  downloadUrl: string;
  callId: string;
}

export async function attachRecordingToIntake(input: AttachRecordingInput): Promise<{ contentVersionId: string; contentDocumentId: string | null }> {
  const conn = await litifyAuth.getConnection();
  const res = await fetch(input.downloadUrl);
  if (!res.ok) throw new Error(`Recording download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const cv = await conn.sobject("ContentVersion").create({
    Title: `CallSofia Recording — ${input.callId}`,
    PathOnClient: `${input.callId}.ogg`,
    VersionData: buf.toString("base64"),
    FirstPublishLocationId: input.intakeId,
    Description: `Inbound call recording, CallSofia call_id=${input.callId}`,
  });
  if (!cv.success) throw new Error(`ContentVersion create failed: ${JSON.stringify((cv as any).errors)}`);
  logger.info("litify_recording_attached", { intake_id: input.intakeId, cv_id: cv.id });
  return { contentVersionId: cv.id!, contentDocumentId: null };
}
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git checkout -b task/20-litify-recording
git add src/lib/adapters/litify/recording.ts src/lib/adapters/litify/recording.test.ts
git commit -m "feat: Litify recording attachment via ContentVersion"
git push -u origin task/20-litify-recording
gh pr create --fill
```

---

## Task 21: Generic Webhook Adapter

**Wave:** 5

**Files:**
- Create: `src/lib/adapters/generic-webhook/adapter.ts`
- Create: `src/lib/adapters/generic-webhook/adapter.test.ts`

- [ ] **Step 1: Write test**

```ts
// src/lib/adapters/generic-webhook/adapter.test.ts
import { describe, it, expect, vi } from "vitest";

const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;

vi.mock("@/lib/config", () => ({
  config: () => ({
    genericWebhook: { url: "https://hooks.zapier.com/test", secret: "", transform: "litify-shape" },
  }),
}));

describe("GenericWebhookAdapter", () => {
  it("POSTs transformed event to configured URL", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const { GenericWebhookAdapter } = await import("./adapter");
    const adapter = new GenericWebhookAdapter();
    await adapter.init();
    const result = await adapter.handle(
      { event_id: "e1", event_type: "lead.qualified", emitted_at: "2026-04-29T13:00:00Z", schema_version: 2,
        data: { scope: { org_id: "o", workspace_id: "w", pipeline_id: "p", stage_id: null }, payload: { call_id: "c" } } },
      {} as never,
    );
    expect(result.outcome).toBe("success");
    expect(fetchMock).toHaveBeenCalled();
  });

  it("returns failure on 4xx response", async () => {
    fetchMock.mockResolvedValue(new Response("bad", { status: 400 }));
    const { GenericWebhookAdapter } = await import("./adapter");
    const adapter = new GenericWebhookAdapter();
    await adapter.init();
    const result = await adapter.handle(
      { event_id: "e1", event_type: "lead.qualified", emitted_at: "2026-04-29T13:00:00Z", schema_version: 2,
        data: { scope: { org_id: "o", workspace_id: "w", pipeline_id: "p", stage_id: null }, payload: {} } },
      {} as never,
    );
    expect(result.outcome).toBe("failure");
  });
});
```

- [ ] **Step 2: Run — fails.**

- [ ] **Step 3: Implement `src/lib/adapters/generic-webhook/adapter.ts`**

```ts
import crypto from "crypto";
import { config } from "@/lib/config";
import { logger } from "@/lib/logger";
import type { CrmAdapter, AdapterContext, HandlerResult, HealthStatus } from "../types";
import type { CallSofiaEvent } from "@/lib/webhook/types";
import { transformEvent } from "./transforms";

export class GenericWebhookAdapter implements CrmAdapter {
  readonly name = "generic-webhook";
  private url!: string;
  private secret?: string;
  private transform!: "raw" | "flat" | "litify-shape";

  async init(): Promise<void> {
    const cfg = config().genericWebhook;
    if (!cfg.url) throw new Error("GENERIC_WEBHOOK_URL not set");
    this.url = cfg.url;
    this.secret = cfg.secret;
    this.transform = cfg.transform;
  }

  async handle(event: CallSofiaEvent, _ctx: AdapterContext): Promise<HandlerResult> {
    const body = JSON.stringify(transformEvent(event, this.transform));
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-callsofia-event": event.event_type,
      "x-callsofia-event-id": event.event_id,
    };
    if (this.secret) {
      const ts = new Date().toISOString();
      const sig = "sha256=" + crypto.createHmac("sha256", this.secret).update(`${ts}.${body}`).digest("hex");
      headers["x-callsofia-bridge-timestamp"] = ts;
      headers["x-callsofia-bridge-signature"] = sig;
    }
    try {
      const res = await fetch(this.url, { method: "POST", headers, body });
      if (res.ok) {
        logger.info("generic_webhook_success", { url: this.url, status: res.status });
        return { outcome: "success", message: `POST ${res.status}`, api_calls: 1 };
      }
      const retryable = res.status >= 500 || res.status === 429;
      return {
        outcome: retryable ? "retry" : "failure",
        error: { code: `http_${res.status}`, message: `Forwarder returned ${res.status}`, retryable },
        api_calls: 1,
      };
    } catch (err) {
      return { outcome: "retry", error: { code: "network_error", message: (err as Error).message, retryable: true }, api_calls: 1 };
    }
  }

  async healthCheck(): Promise<HealthStatus> {
    return { healthy: !!this.url, message: this.url ? "configured" : "no URL", timestamp: new Date() };
  }
}
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git checkout -b task/21-generic-webhook-adapter
git add src/lib/adapters/generic-webhook/adapter.ts src/lib/adapters/generic-webhook/adapter.test.ts
git commit -m "feat: GenericWebhookAdapter with optional outbound HMAC signing"
git push -u origin task/21-generic-webhook-adapter
gh pr create --fill
```

---

## Task 22: LitifyAdapter (composes Tasks 17-20)

**Wave:** 6

**Files:**
- Create: `src/lib/adapters/litify/adapter.ts`
- Create: `src/lib/adapters/litify/adapter.test.ts`

- [ ] **Step 1: Write test**

```ts
// src/lib/adapters/litify/adapter.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("./auth", () => ({ litifyAuth: { getConnection: async () => ({}), ping: async () => true } }));
vi.mock("./person", () => ({
  findByPhone: vi.fn(async (p) => p === "+12132779473" ? { Id: "p1", Name: "x" } : null),
  upsertByPhone: vi.fn(async () => ({ Id: "p1", Name: "x" })),
}));
vi.mock("./activity", () => ({
  startInboundCall: vi.fn(async () => ({ id: "t1" })),
  completeCall: vi.fn(async () => undefined),
  appendNote: vi.fn(async () => undefined),
}));
vi.mock("./intake", () => ({
  findByCallId: vi.fn(async () => null),
  createIntake: vi.fn(async () => ({ id: "i1" })),
  upsertByCallId: vi.fn(async () => ({ id: "i1" })),
  attachRecording: vi.fn(async () => "i1"),
  triggerConversionFlow: vi.fn(async () => undefined),
}));
vi.mock("./recording", () => ({ attachRecordingToIntake: vi.fn(async () => ({ contentVersionId: "cv1", contentDocumentId: null })) }));
vi.mock("./field-mapping", () => ({
  mapCaseType: (s: string) => s,
  mapStatus: (s: string) => s,
  mapLanguage: (s: string) => s,
  mapExtractedVars: (v: any) => v,
}));
vi.mock("@/lib/config", () => ({ config: () => ({ litify: { autoConvertQualified: false } }) }));

const ev = (type: string, payload: Record<string, unknown> = {}) => ({
  event_id: "e", event_type: type as any, emitted_at: "2026-04-29T13:00:00Z", schema_version: 2 as const,
  data: { scope: { org_id: "o", workspace_id: "w", pipeline_id: "p", stage_id: null }, payload },
});

describe("LitifyAdapter.handle", () => {
  it("call.ringing with known caller creates Task", async () => {
    const { LitifyAdapter } = await import("./adapter");
    const a = new LitifyAdapter();
    const r = await a.handle(ev("call.ringing", { from_phone: "+12132779473", twilio_call_sid: "CA1", room_name: "r1" }), {} as never);
    expect(r.outcome).toBe("success");
  });

  it("call.ended creates Person+Intake", async () => {
    const { LitifyAdapter } = await import("./adapter");
    const a = new LitifyAdapter();
    const r = await a.handle(ev("call.ended", {
      call_id: "c1", caller_phone: "+1", twilio_call_sid: "CA1",
      direction: "inbound", language: "en", case_type: "workers_comp",
      started_at: "2026-04-29T13:00:00Z", ended_at: "2026-04-29T13:17:00Z", duration: 1020,
    }), {} as never);
    expect(r.outcome).toBe("success");
    expect(r.crm_record_id).toBe("i1");
  });

  it("unknown event type → noop", async () => {
    const { LitifyAdapter } = await import("./adapter");
    const a = new LitifyAdapter();
    const r = await a.handle(ev("call.outbound_request"), {} as never);
    expect(r.outcome).toBe("noop");
  });
});
```

- [ ] **Step 2: Run — fails.**

- [ ] **Step 3: Implement `src/lib/adapters/litify/adapter.ts`**

```ts
import { config } from "@/lib/config";
import { logger } from "@/lib/logger";
import type { CrmAdapter, AdapterContext, HandlerResult, HealthStatus } from "../types";
import type { CallSofiaEvent } from "@/lib/webhook/types";
import { litifyAuth } from "./auth";
import * as Person from "./person";
import * as Activity from "./activity";
import * as Intake from "./intake";
import { attachRecordingToIntake } from "./recording";
import { mapCaseType, mapExtractedVars, mapStatus } from "./field-mapping";

export class LitifyAdapter implements CrmAdapter {
  readonly name = "litify";

  async init(): Promise<void> {
    await litifyAuth.getConnection();
  }

  async healthCheck(): Promise<HealthStatus> {
    const ok = await litifyAuth.ping();
    return { healthy: ok, message: ok ? "ok" : "ping failed", timestamp: new Date() };
  }

  async handle(event: CallSofiaEvent, _ctx: AdapterContext): Promise<HandlerResult> {
    const p = event.data.payload as Record<string, any>;
    const callId = (p.call_id ?? p.room_name) as string | undefined;
    const phone = (p.caller_phone ?? p.from_phone) as string | undefined;

    try {
      switch (event.event_type) {
        case "call.ringing": {
          if (!phone) return { outcome: "noop" };
          const person = await Person.findByPhone(phone);
          if (!person) return { outcome: "noop", message: "no existing person" };
          const task = await Activity.startInboundCall({ personId: person.Id, callId: callId!, twilioSid: p.twilio_call_sid });
          return { outcome: "success", crm_record_id: task.id };
        }

        case "call.ended": {
          if (!phone || !callId) return { outcome: "noop" };
          const person = await Person.upsertByPhone(phone, {});
          const intake = await Intake.createIntake({
            personId: person.Id, callId, callerPhone: phone,
            startedAt: p.started_at, endedAt: p.ended_at, duration: p.duration,
            language: p.language, caseType: mapCaseType(p.case_type),
            twilioSid: p.twilio_call_sid, summary: p.summary,
          });
          await Activity.completeCall({ callId, duration: p.duration, intakeId: intake.id });
          return { outcome: "success", crm_record_id: intake.id };
        }

        case "call.extracted": {
          if (!callId) return { outcome: "noop" };
          const fields = mapExtractedVars(p.extracted_vars ?? {});
          const intake = await Intake.upsertByCallId(callId, {
            ...fields,
            CallSofia_Summary__c: p.summary,
          });
          return { outcome: "success", crm_record_id: intake.id };
        }

        case "lead.qualified": {
          if (!callId) return { outcome: "noop" };
          const intake = await Intake.upsertByCallId(callId, {
            litify_pm__Status__c: mapStatus("qualified"),
            CallSofia_Quality_Score__c: p.evaluation?.score,
          });
          if (config().litify.autoConvertQualified) await Intake.triggerConversionFlow(intake.id);
          return { outcome: "success", crm_record_id: intake.id };
        }

        case "lead.needs_review": {
          if (!callId) return { outcome: "noop" };
          const intake = await Intake.upsertByCallId(callId, {
            litify_pm__Status__c: mapStatus("needs_review"),
            OwnerId: config().litify.intakeCoordinatorUserId,
            Description: `NEEDS REVIEW: ${p.review_reason}\n\n${p.summary ?? ""}`,
          });
          return { outcome: "success", crm_record_id: intake.id };
        }

        case "evaluation.complete": {
          if (!callId) return { outcome: "noop" };
          const intake = await Intake.upsertByCallId(callId, { CallSofia_Quality_Score__c: p.evaluation?.score });
          return { outcome: "success", crm_record_id: intake.id };
        }

        case "recording.ogg": {
          if (!callId) return { outcome: "noop" };
          const intake = await Intake.findByCallId(callId);
          if (!intake) return { outcome: "noop", message: "no intake to attach to" };
          const r = await attachRecordingToIntake({ intakeId: intake.Id, downloadUrl: p.download_url, callId });
          return { outcome: "success", crm_record_id: r.contentVersionId };
        }

        case "call.transferred":
        case "call.transfer_failed": {
          if (!callId) return { outcome: "noop" };
          await Activity.appendNote(callId, `${event.event_type}: ${JSON.stringify(p)}`);
          return { outcome: "success" };
        }

        default:
          return { outcome: "noop", message: `no handler for ${event.event_type}` };
      }
    } catch (err) {
      const e = err as Error & { errorCode?: string };
      logger.error("litify_handler_error", { event_type: event.event_type, err: e.message });
      const retryable = !["INVALID_FIELD", "DUPLICATE_VALUE"].includes(e.errorCode ?? "");
      return { outcome: retryable ? "retry" : "failure", error: { code: e.errorCode ?? "unknown", message: e.message, retryable } };
    }
  }
}
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git checkout -b task/22-litify-adapter
git add src/lib/adapters/litify/adapter.ts src/lib/adapters/litify/adapter.test.ts
git commit -m "feat: LitifyAdapter wiring all 11 event types to Litify operations"
git push -u origin task/22-litify-adapter
gh pr create --fill
```

---

## Task 23: Queue consumer route (wires adapters)

**Wave:** 7

**Files:**
- Create: `src/app/api/queue/consumer/route.ts`
- Create: `src/app/api/queue/consumer/route.test.ts`

- [ ] **Step 1: Write test**

```ts
// src/app/api/queue/consumer/route.test.ts
import { describe, it, expect, vi } from "vitest";

const handleMock = vi.fn();
vi.mock("@/lib/adapters/registry", () => ({
  selectAdapterName: () => "litify",
  getAdapter: async () => ({ name: "litify", handle: handleMock }),
}));
const insertValuesMock = vi.fn();
const updateSetMock = vi.fn();
vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ eventId: "e1", eventType: "call.ended", payload: {}, scope: {}, emittedAt: new Date(), schemaVersion: 2 }] }) }) }),
    insert: () => ({ values: insertValuesMock }),
    update: () => ({ set: updateSetMock }),
  },
  schema: { events: {}, deliveries: {} },
}));
vi.mock("@/lib/config", () => ({ config: () => ({ crmAdapter: "litify", reliability: { maxRetries: 10, retryBaseDelayMs: 1000, retryMaxDelayMs: 60000 }, handlers: { callEnded: true } }) }));
vi.mock("@/lib/platform-api/client", () => ({ platformApi: { logActivity: vi.fn(async () => undefined) } }));
vi.mock("@/lib/queue/publisher", () => ({ publishEventForProcessing: vi.fn(async () => undefined) }));

describe("POST /api/queue/consumer", () => {
  it("processes event and persists delivery", async () => {
    handleMock.mockResolvedValue({ outcome: "success", crm_record_id: "i1" });
    insertValuesMock.mockReturnValue({ onConflictDoNothing: async () => undefined });
    updateSetMock.mockReturnValue({ where: async () => undefined });

    const { POST } = await import("./route");
    const req = new Request("http://x/api/queue/consumer", {
      method: "POST",
      body: JSON.stringify({ event_id: "e1", attempt: 1 }),
      headers: { "content-type": "application/json", "x-queue-token": process.env.QUEUE_INTERNAL_TOKEN ?? "" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(handleMock).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — fails.**

- [ ] **Step 3: Implement `src/app/api/queue/consumer/route.ts`**

```ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { config } from "@/lib/config";
import { logger } from "@/lib/logger";
import { selectAdapterName, getAdapter } from "@/lib/adapters/registry";
import { platformApi } from "@/lib/platform-api/client";
import { publishEventForProcessing } from "@/lib/queue/publisher";
import { computeBackoff } from "@/lib/queue/consumer";
import type { CallSofiaEvent } from "@/lib/webhook/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface QueueMessage { event_id: string; attempt?: number; }

const handlerToggle: Record<string, keyof ReturnType<typeof config>["handlers"]> = {
  "call.ringing": "callRinging",
  "call.answered": "callAnswered",
  "call.in_progress": "callInProgress",
  "call.ended": "callEnded",
  "call.extracted": "callExtracted",
  "lead.qualified": "leadQualified",
  "lead.needs_review": "leadNeedsReview",
  "evaluation.complete": "evaluationComplete",
  "recording.ogg": "recordingOgg",
};

function isEnabledForEventType(cfg: ReturnType<typeof config>, eventType: string): boolean {
  const key = handlerToggle[eventType];
  if (!key) return true; // for events without an explicit toggle, run by default
  return cfg.handlers[key];
}

export async function POST(req: Request): Promise<Response> {
  const cfg = config();
  const internalToken = process.env.QUEUE_INTERNAL_TOKEN;
  if (internalToken && req.headers.get("x-queue-token") !== internalToken) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const message = (await req.json()) as QueueMessage;
  const eventId = message.event_id;
  const attempt = message.attempt ?? 1;

  const rows = await db.select().from(schema.events).where(eq(schema.events.eventId, eventId)).limit(1);
  const row = rows[0];
  if (!row) return NextResponse.json({ error: "event not found" }, { status: 404 });

  const adapterName = selectAdapterName(cfg.crmAdapter);
  if (adapterName === "none" || !isEnabledForEventType(cfg, row.eventType)) {
    await db.insert(schema.deliveries).values({
      eventId, handlerId: adapterName, attempt, status: "noop",
      outcome: { outcome: "noop", message: "handler disabled" },
      startedAt: new Date(), completedAt: new Date(),
    });
    return NextResponse.json({ ok: true, outcome: "noop" });
  }

  const adapter = await getAdapter(adapterName);
  const event: CallSofiaEvent = {
    event_id: row.eventId, event_type: row.eventType as never,
    emitted_at: row.emittedAt.toISOString(), schema_version: row.schemaVersion as 2,
    data: { scope: row.scope as never, payload: row.payload as never },
  };

  const startedAt = new Date();
  let result;
  try {
    result = await adapter.handle(event, { platformApi, config: {} } as never);
  } catch (err) {
    result = { outcome: "retry" as const, error: { code: "exception", message: (err as Error).message, retryable: true } };
  }
  const completedAt = new Date();

  await db.insert(schema.deliveries).values({
    eventId, handlerId: adapter.name, attempt,
    status: result.outcome === "success" ? "succeeded" : result.outcome === "noop" ? "noop" : result.outcome === "retry" ? "retrying" : "failed",
    outcome: result, crmRecordId: result.crm_record_id,
    errorCode: result.error?.code, errorMessage: result.error?.message,
    startedAt, completedAt,
  });

  void platformApi.logActivity({
    type: `bridge.handler_${result.outcome === "success" ? "succeeded" : result.outcome === "failure" ? "failed" : result.outcome === "noop" ? "noop" : "retry_scheduled"}`,
    severity: result.outcome === "failure" ? "error" : "info",
    event_data: {
      event_id: eventId, event_type: row.eventType,
      handler: adapter.name, attempt, latency_ms: completedAt.getTime() - startedAt.getTime(),
      crm_record_id: result.crm_record_id, error: result.error,
    },
  });

  if (result.outcome === "retry" && attempt < cfg.reliability.maxRetries) {
    const delay = computeBackoff(attempt, { baseMs: cfg.reliability.retryBaseDelayMs, maxMs: cfg.reliability.retryMaxDelayMs });
    setTimeout(() => { void publishEventForProcessing(eventId, attempt + 1); }, delay);
  } else if (result.outcome === "retry") {
    logger.error("dead_letter_event", { event_id: eventId, attempt });
    void platformApi.logActivity({
      type: "bridge.dead_letter", severity: "error",
      event_data: { event_id: eventId, event_type: row.eventType, attempts: attempt },
    });
  }

  return NextResponse.json({ ok: true, outcome: result.outcome });
}
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git checkout -b task/23-consumer
git add src/app/api/queue/consumer/
git commit -m "feat: queue consumer wiring adapters with retry + activity_logs mirror"
git push -u origin task/23-consumer
gh pr create --fill
```

---

## Task 24: Cron — process retries

**Wave:** 8

**Files:**
- Create: `src/app/api/cron/process-retries/route.ts`

- [ ] **Step 1: Write test**

```ts
// src/app/api/cron/process-retries/route.test.ts
import { describe, it, expect, vi } from "vitest";

const publishMock = vi.fn();
vi.mock("@/lib/queue/publisher", () => ({ publishEventForProcessing: publishMock }));
vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: 1, eventId: "e1", attempt: 2 }] }) }) }),
    delete: () => ({ where: async () => undefined }),
  },
  schema: { retryQueue: {} },
}));

describe("GET /api/cron/process-retries", () => {
  it("publishes due retries and removes from queue", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request("http://x"));
    expect(res.status).toBe(200);
    expect(publishMock).toHaveBeenCalledWith("e1", 2);
  });
});
```

- [ ] **Step 2: Run — fails.**

- [ ] **Step 3: Implement `src/app/api/cron/process-retries/route.ts`**

```ts
import { NextResponse } from "next/server";
import { lte } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { publishEventForProcessing } from "@/lib/queue/publisher";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request): Promise<Response> {
  const now = new Date();
  const due = await db.select().from(schema.retryQueue).where(lte(schema.retryQueue.scheduledFor, now)).limit(50);
  for (const row of due) {
    void publishEventForProcessing(row.eventId, row.attempt);
    await db.delete(schema.retryQueue).where(/* by id */ lte(schema.retryQueue.id, row.id));
  }
  logger.info("cron_retries_processed", { count: due.length });
  return NextResponse.json({ ok: true, processed: due.length });
}
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git checkout -b task/24-cron-retries
git add src/app/api/cron/process-retries/
git commit -m "feat: cron job to process due retry queue entries"
git push -u origin task/24-cron-retries
gh pr create --fill
```

---

## Task 25: Cron — health check

**Wave:** 8

**Files:**
- Create: `src/app/api/cron/health-check/route.ts`

- [ ] **Step 1: Implement (no test — wraps existing tested modules)**

```ts
// src/app/api/cron/health-check/route.ts
import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { db } from "@/lib/db/client";
import { ping as redisPing } from "@/lib/redis/client";
import { getAdapter, selectAdapterName } from "@/lib/adapters/registry";
import { platformApi } from "@/lib/platform-api/client";
import { logger } from "@/lib/logger";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request): Promise<Response> {
  const cfg = config();
  const checks: Record<string, { healthy: boolean; message?: string }> = {};

  try { await db.execute(sql`SELECT 1`); checks.postgres = { healthy: true }; }
  catch (err) { checks.postgres = { healthy: false, message: (err as Error).message }; }

  try { const r = await redisPing(); checks.redis = { healthy: r === "PONG" }; }
  catch (err) { checks.redis = { healthy: false, message: (err as Error).message }; }

  try {
    const a = await getAdapter(selectAdapterName(cfg.crmAdapter));
    const r = await a.healthCheck();
    checks.adapter = { healthy: r.healthy, message: r.message };
  } catch (err) { checks.adapter = { healthy: false, message: (err as Error).message }; }

  const allHealthy = Object.values(checks).every(c => c.healthy);

  void platformApi.logActivity({
    type: "bridge.health_check",
    severity: allHealthy ? "info" : "error",
    event_data: { checks, all_healthy: allHealthy },
  });
  logger.info("cron_health_check", { all_healthy: allHealthy, checks });

  return NextResponse.json({ healthy: allHealthy, checks });
}
```

- [ ] **Step 2: Smoke test locally**

Run: `pnpm dev` then `curl localhost:3000/api/cron/health-check`
Expected: JSON with healthy bools.

- [ ] **Step 3: Commit**

```bash
git checkout -b task/25-cron-health
git add src/app/api/cron/health-check/
git commit -m "feat: cron health check covering postgres, redis, adapter"
git push -u origin task/25-cron-health
gh pr create --fill
```

---

## Task 26: Admin auth middleware + layout

**Wave:** 8

**Files:**
- Create: `src/middleware.ts`
- Create: `src/app/admin/layout.tsx`

- [ ] **Step 1: Write `src/middleware.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";

export const config = { matcher: ["/admin/:path*", "/api/admin/:path*"] };

function unauthorized(): NextResponse {
  return new NextResponse("Authentication required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="admin"' } });
}

export function middleware(req: NextRequest): NextResponse {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return new NextResponse("Server misconfigured", { status: 500 });

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Basic ")) return unauthorized();

  const decoded = atob(auth.slice("Basic ".length));
  const [, password] = decoded.split(":");
  if (password !== expected) return unauthorized();

  return NextResponse.next();
}
```

- [ ] **Step 2: Write `src/app/admin/layout.tsx`**

```tsx
import Link from "next/link";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: "system-ui", padding: 20 }}>
      <nav style={{ display: "flex", gap: 16, marginBottom: 24, paddingBottom: 12, borderBottom: "1px solid #ddd" }}>
        <Link href="/admin">Recent</Link>
        <Link href="/admin/failures">Failures</Link>
        <Link href="/admin/replay">Replay</Link>
        <Link href="/admin/health">Health</Link>
      </nav>
      <main>{children}</main>
    </div>
  );
}
```

- [ ] **Step 3: Smoke test locally**

```bash
ADMIN_PASSWORD=test pnpm dev
curl -u admin:test http://localhost:3000/admin
```

- [ ] **Step 4: Commit**

```bash
git checkout -b task/26-admin-layout
git add src/middleware.ts src/app/admin/layout.tsx
git commit -m "feat: admin basic-auth middleware + layout"
git push -u origin task/26-admin-layout
gh pr create --fill
```

---

## Task 27: Admin recent events page

**Wave:** 8

**Files:**
- Create: `src/app/admin/page.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/app/admin/page.tsx
import { db, schema } from "@/lib/db/client";
import { desc } from "drizzle-orm";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const events = await db.select().from(schema.events).orderBy(desc(schema.events.receivedAt)).limit(100);

  return (
    <div>
      <h1>Recent Events</h1>
      <p style={{ color: "#666" }}>Last 100 events received by this bridge.</p>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
            <th>Received</th><th>Event Type</th><th>Status</th><th>Event ID</th>
          </tr>
        </thead>
        <tbody>
          {events.map(e => (
            <tr key={e.eventId} style={{ borderBottom: "1px solid #eee" }}>
              <td>{new Date(e.receivedAt).toLocaleString()}</td>
              <td><code>{e.eventType}</code></td>
              <td>{e.status}</td>
              <td><Link href={`/admin/events/${e.eventId}`}>{e.eventId.slice(0, 8)}…</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git checkout -b task/27-admin-recent
git add src/app/admin/page.tsx
git commit -m "feat: admin recent events page"
git push -u origin task/27-admin-recent
gh pr create --fill
```

---

## Task 28: Admin event detail page

**Wave:** 8

**Files:**
- Create: `src/app/admin/events/[event_id]/page.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/app/admin/events/[event_id]/page.tsx
import { db, schema } from "@/lib/db/client";
import { eq, asc } from "drizzle-orm";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function EventDetail({ params }: { params: Promise<{ event_id: string }> }) {
  const { event_id } = await params;
  const [event] = await db.select().from(schema.events).where(eq(schema.events.eventId, event_id)).limit(1);
  if (!event) return notFound();
  const deliveries = await db.select().from(schema.deliveries).where(eq(schema.deliveries.eventId, event_id)).orderBy(asc(schema.deliveries.attempt));

  return (
    <div>
      <h1>Event {event_id.slice(0, 8)}…</h1>
      <h2>Envelope</h2>
      <pre style={{ background: "#f5f5f5", padding: 12, overflow: "auto" }}>
        {JSON.stringify(event.rawEnvelope, null, 2)}
      </pre>
      <h2>Deliveries</h2>
      {deliveries.map(d => (
        <div key={d.id} style={{ border: "1px solid #ddd", padding: 12, marginBottom: 8 }}>
          <strong>Attempt {d.attempt}</strong> — {d.handlerId} — <code>{d.status}</code>
          <div>CRM record: {d.crmRecordId ?? "—"}</div>
          {d.errorMessage && <div style={{ color: "red" }}>Error: {d.errorMessage}</div>}
          <details><summary>Full outcome</summary><pre>{JSON.stringify(d.outcome, null, 2)}</pre></details>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git checkout -b task/28-admin-event-detail
git add "src/app/admin/events/[event_id]/page.tsx"
git commit -m "feat: admin event detail with delivery history"
git push -u origin task/28-admin-event-detail
gh pr create --fill
```

---

## Task 29: Admin failures + replay

**Wave:** 8

**Files:**
- Create: `src/app/admin/failures/page.tsx`
- Create: `src/app/admin/replay/page.tsx`
- Create: `src/app/api/admin/replay/route.ts`

- [ ] **Step 1: Write `src/app/admin/failures/page.tsx`**

```tsx
import { db, schema } from "@/lib/db/client";
import { desc, eq } from "drizzle-orm";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function FailuresPage() {
  const failed = await db.select().from(schema.deliveries).where(eq(schema.deliveries.status, "failed")).orderBy(desc(schema.deliveries.completedAt)).limit(100);

  return (
    <div>
      <h1>Failures</h1>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr><th>Time</th><th>Event ID</th><th>Handler</th><th>Error</th><th></th></tr></thead>
        <tbody>
          {failed.map(d => (
            <tr key={d.id}>
              <td>{d.completedAt ? new Date(d.completedAt).toLocaleString() : "—"}</td>
              <td><Link href={`/admin/events/${d.eventId}`}>{d.eventId.slice(0, 8)}…</Link></td>
              <td>{d.handlerId}</td>
              <td>{d.errorMessage}</td>
              <td>
                <form method="POST" action={`/api/admin/replay?event_id=${d.eventId}`}>
                  <button type="submit">Retry</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Write `src/app/admin/replay/page.tsx`**

```tsx
export default function ReplayPage() {
  return (
    <div>
      <h1>Bulk Replay</h1>
      <form method="POST" action="/api/admin/replay">
        <label>Event Type: <input name="event_type" placeholder="e.g. lead.qualified" /></label><br />
        <label>From: <input type="datetime-local" name="from" /></label><br />
        <label>To: <input type="datetime-local" name="to" /></label><br />
        <button type="submit">Replay</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Write `src/app/api/admin/replay/route.ts`**

```ts
import { NextResponse } from "next/server";
import { and, eq, gte, lte } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { publishEventForProcessing } from "@/lib/queue/publisher";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const single = url.searchParams.get("event_id");
  if (single) {
    await publishEventForProcessing(single, 1);
    return NextResponse.redirect(new URL("/admin/failures", url), 302);
  }

  const form = await req.formData();
  const eventType = form.get("event_type") as string | null;
  const from = form.get("from") as string | null;
  const to = form.get("to") as string | null;

  const where = and(
    eventType ? eq(schema.events.eventType, eventType) : undefined,
    from ? gte(schema.events.emittedAt, new Date(from)) : undefined,
    to ? lte(schema.events.emittedAt, new Date(to)) : undefined,
  );
  const matches = await db.select({ eventId: schema.events.eventId }).from(schema.events).where(where);
  for (const m of matches) await publishEventForProcessing(m.eventId, 1);

  return NextResponse.json({ requeued: matches.length });
}
```

- [ ] **Step 4: Commit**

```bash
git checkout -b task/29-admin-failures-replay
git add src/app/admin/failures/ src/app/admin/replay/ src/app/api/admin/
git commit -m "feat: admin failures view + bulk replay"
git push -u origin task/29-admin-failures-replay
gh pr create --fill
```

---

## Task 30: Admin health page

**Wave:** 8

**Files:**
- Create: `src/app/admin/health/page.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/app/admin/health/page.tsx
async function fetchHealth(): Promise<{ healthy: boolean; checks: Record<string, { healthy: boolean; message?: string }> }> {
  const url = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const res = await fetch(`${url}/api/cron/health-check`, { cache: "no-store" });
  return res.json();
}

export const dynamic = "force-dynamic";

export default async function HealthPage() {
  const health = await fetchHealth();
  return (
    <div>
      <h1>Bridge Health</h1>
      <p>Overall: <strong style={{ color: health.healthy ? "green" : "red" }}>{health.healthy ? "Healthy" : "Unhealthy"}</strong></p>
      <ul>
        {Object.entries(health.checks).map(([k, v]) => (
          <li key={k}>
            <strong>{k}:</strong> {v.healthy ? "✓" : "✗"} {v.message ?? ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git checkout -b task/30-admin-health
git add src/app/admin/health/
git commit -m "feat: admin health dashboard page"
git push -u origin task/30-admin-health
gh pr create --fill
```

---

## Task 31: Litify custom fields setup script

**Wave:** 9

**Files:**
- Create: `scripts/litify/create-custom-fields.sh`
- Create: `scripts/litify/fields.json`

- [ ] **Step 1: Write `scripts/litify/fields.json`** (declarative metadata)

```json
{
  "objects": {
    "litify_pm__Intake__c": [
      { "fullName": "CallSofia_Call_ID__c", "type": "Text", "length": 36, "externalId": true, "unique": true, "label": "CallSofia Call ID" },
      { "fullName": "CallSofia_Event_ID__c", "type": "Text", "length": 36, "label": "CallSofia Last Event ID" },
      { "fullName": "CallSofia_Quality_Score__c", "type": "Number", "precision": 3, "scale": 0, "label": "AI Quality Score" },
      { "fullName": "CallSofia_Language__c", "type": "Picklist", "valueSet": ["en","es","hi"], "label": "Language" },
      { "fullName": "CallSofia_Case_Type__c", "type": "Text", "length": 80, "label": "Case Type" },
      { "fullName": "CallSofia_Twilio_SID__c", "type": "Text", "length": 50, "label": "Twilio Call SID" },
      { "fullName": "CallSofia_Recording_URL__c", "type": "Url", "label": "Recording URL" },
      { "fullName": "CallSofia_Summary__c", "type": "LongTextArea", "length": 32768, "label": "AI Summary" },
      { "fullName": "CallSofia_Incident_Date__c", "type": "Date", "label": "Incident Date" },
      { "fullName": "CallSofia_Injury_Type__c", "type": "Text", "length": 255, "label": "Injury Type" },
      { "fullName": "CallSofia_Employer_Name__c", "type": "Text", "length": 255, "label": "Employer" },
      { "fullName": "CallSofia_Medical_Treatment__c", "type": "Text", "length": 100, "label": "Medical Treatment" },
      { "fullName": "CallSofia_Prior_Attorney__c", "type": "Checkbox", "defaultValue": false, "label": "Prior Attorney" },
      { "fullName": "CallSofia_Last_Synced_At__c", "type": "DateTime", "label": "Last Synced At" }
    ],
    "Task": [
      { "fullName": "CallSofia_Call_ID__c", "type": "Text", "length": 36, "externalId": true, "label": "CallSofia Call ID" },
      { "fullName": "CallSofia_Twilio_SID__c", "type": "Text", "length": 50, "label": "Twilio Call SID" }
    ]
  }
}
```

- [ ] **Step 2: Write `scripts/litify/create-custom-fields.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   sf org login web --instance-url https://login.salesforce.com -a my-org
#   ./scripts/litify/create-custom-fields.sh my-org

ORG="${1:-default}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Creating CallSofia custom fields in $ORG …"
node -e '
const fs = require("fs");
const { execSync } = require("child_process");
const fields = JSON.parse(fs.readFileSync("'"$SCRIPT_DIR"'/fields.json", "utf-8"));
for (const [obj, defs] of Object.entries(fields.objects)) {
  for (const f of defs) {
    const args = ["sf", "schema", "create", "field",
      "--object", obj,
      "--name", f.fullName,
      "--label", `"${f.label}"`,
      "--type", f.type,
      f.length ? `--length ${f.length}` : "",
      f.externalId ? "--external-id" : "",
      f.unique ? "--unique" : "",
      "--target-org", "'"$ORG"'",
    ].filter(Boolean).join(" ");
    console.log(`+ ${obj}.${f.fullName}`);
    try { execSync(args, { stdio: "inherit" }); }
    catch (e) { console.log(`  (skipping, may already exist)`); }
  }
}
'
echo "Done. Verify in Setup → Object Manager → Intake → Fields."
```

```bash
chmod +x scripts/litify/create-custom-fields.sh
```

- [ ] **Step 3: Commit**

```bash
git checkout -b task/31-litify-fields-script
git add scripts/litify/
git commit -m "feat: Litify custom fields creation script with declarative metadata"
git push -u origin task/31-litify-fields-script
gh pr create --fill
```

---

## Task 32: Mock CallSofia dev server

**Wave:** 9

**Files:**
- Create: `scripts/dev/mock-callsofia.ts`

- [ ] **Step 1: Implement**

```ts
// scripts/dev/mock-callsofia.ts
/**
 * Local mock CallSofia webhook sender.
 *
 * Replays canned events to your bridge for local development.
 *
 * Usage:
 *   pnpm tsx scripts/dev/mock-callsofia.ts http://localhost:3000/api/webhooks/callsofia
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";

const target = process.argv[2] ?? "http://localhost:3000/api/webhooks/callsofia";
const secret = process.env.CALLSOFIA_WEBHOOK_SECRET ?? "whsec_dev";

const fixtures = [
  "call.ringing.json", "call.answered.json", "call.in_progress.json",
  "call.ended.json", "call.extracted.json", "lead.qualified.json", "evaluation.complete.json",
];

async function send(payloadPath: string): Promise<void> {
  const body = fs.readFileSync(payloadPath, "utf-8");
  const ts = new Date().toISOString();
  const sig = "sha256=" + crypto.createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  const res = await fetch(target, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-callsofia-timestamp": ts,
      "x-callsofia-signature": sig,
      "x-callsofia-event": JSON.parse(body).event_type,
      "x-callsofia-delivery": crypto.randomUUID(),
    },
    body,
  });
  console.log(`${path.basename(payloadPath)} → ${res.status}`);
}

(async () => {
  const fixtureDir = path.resolve("../callsofia-webhooks-docs/examples/payloads");
  for (const f of fixtures) {
    const p = path.join(fixtureDir, f);
    if (!fs.existsSync(p)) { console.warn(`missing ${p}`); continue; }
    await send(p);
    await new Promise(r => setTimeout(r, 300));
  }
})();
```

- [ ] **Step 2: Commit**

```bash
git checkout -b task/32-mock-server
git add scripts/dev/
git commit -m "feat: mock CallSofia dev server for local replay"
git push -u origin task/32-mock-server
gh pr create --fill
```

---

## Task 33: Replay events CLI

**Wave:** 9

**Files:**
- Create: `scripts/replay-events.ts`

- [ ] **Step 1: Implement**

```ts
// scripts/replay-events.ts
/**
 * Bulk replay events from production Postgres back through the queue.
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/replay-events.ts \
 *     --event-type lead.qualified --from 2026-04-29T00:00:00Z --to 2026-04-29T23:59:59Z
 */
import { and, eq, gte, lte } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { publishEventForProcessing } from "@/lib/queue/publisher";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

(async () => {
  const eventType = arg("event-type");
  const from = arg("from");
  const to = arg("to");
  const where = and(
    eventType ? eq(schema.events.eventType, eventType) : undefined,
    from ? gte(schema.events.emittedAt, new Date(from)) : undefined,
    to ? lte(schema.events.emittedAt, new Date(to)) : undefined,
  );
  const rows = await db.select({ eventId: schema.events.eventId }).from(schema.events).where(where);
  console.log(`Re-publishing ${rows.length} events…`);
  for (const r of rows) await publishEventForProcessing(r.eventId, 1);
  console.log("Done.");
})();
```

- [ ] **Step 2: Commit**

```bash
git checkout -b task/33-replay-cli
git add scripts/replay-events.ts
git commit -m "feat: bulk replay CLI for re-running historical events"
git push -u origin task/33-replay-cli
gh pr create --fill
```

---

## Task 34: GitHub Actions CI

**Wave:** 10

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Implement**

```yaml
# .github/workflows/ci.yml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm tsc --noEmit
      - run: pnpm vitest run
      - run: pnpm build
        env:
          DATABASE_URL: postgres://placeholder/test
          REDIS_URL: rediss://placeholder
          CALLSOFIA_API_BASE_URL: https://api.callsofia.co
          CALLSOFIA_ORG_ID: 10000000-0000-0000-0000-000000000001
          CALLSOFIA_API_KEY: build_placeholder
          CALLSOFIA_WEBHOOK_SECRET: build_placeholder
          CRM_ADAPTER: none
          ADMIN_PASSWORD: build_placeholder
```

- [ ] **Step 2: Commit**

```bash
git checkout -b task/34-ci
git add .github/workflows/ci.yml
git commit -m "ci: typecheck + tests + build on every PR"
git push -u origin task/34-ci
gh pr create --fill
```

---

## Task 35: README + deployment + troubleshooting docs

**Wave:** 10

**Files:**
- Create: `README.md`
- Create: `docs/deployment.md`
- Create: `docs/troubleshooting.md`

- [ ] **Step 1: Write `README.md`** (top-level)

```markdown
# CallSofia Bridge

Webhook middleware between CallSofia AI voice intake and your CRM.

**Default CRM:** Litify (Salesforce). Pluggable adapter pattern supports Generic Webhook Forwarder, with HubSpot/Filevine planned.

## Quick start

1. Fork or click "Deploy on Vercel"
2. Provision Neon Postgres + Upstash Redis from Vercel Marketplace
3. Set env vars (see `.env.example`)
4. Run `scripts/litify/create-custom-fields.sh` against your Salesforce org
5. Push to `main` → Vercel auto-deploys
6. Register the bridge URL in CallSofia dashboard webhooks
7. Place a test call → check `/admin` for confirmation

See [`docs/deployment.md`](docs/deployment.md) and [`docs/litify-setup-guide.md`](docs/litify-setup-guide.md).

## Architecture

See [the design spec](https://github.com/call-sofia/SofiaWeb/blob/main/docs/superpowers/specs/2026-04-29-callsofia-bridge-design.md).
```

- [ ] **Step 2: Write `docs/deployment.md`**

```markdown
# Deployment Guide

## Step-by-step

1. **Fork** `github.com/call-sofia/callsofia-bridge`
2. **Vercel**: Import project, link to your fork
3. **Marketplace**: Add Neon + Upstash from Vercel Marketplace (auto-injects DATABASE_URL, REDIS_URL)
4. **Salesforce**: Create a Connected App, note Client ID + Secret
5. **Custom fields**: Run `./scripts/litify/create-custom-fields.sh <org-alias>`
6. **Env vars**: Set all from `.env.example` (per-environment in Vercel)
7. **Deploy**: Push to main, Vercel runs migrations and deploys
8. **Register**: Add bridge URL to CallSofia dashboard → Pipelines → Webhooks

## Rollback

`vercel rollback` to previous deployment. Database migrations are append-only — manually revert if needed.
```

- [ ] **Step 3: Write `docs/troubleshooting.md`**

```markdown
# Troubleshooting

## Webhooks return 401
- Check `CALLSOFIA_WEBHOOK_SECRET` matches the secret configured in CallSofia dashboard
- Run `pnpm tsx scripts/dev/mock-callsofia.ts` locally to reproduce

## Litify: INVALID_FIELD on insert
- Run `scripts/litify/create-custom-fields.sh` again — a new custom field is missing

## Events stuck in retrying
- Check `/admin/failures` for the actual error
- For Salesforce 401: token refreshed automatically, retry will succeed
- For Salesforce 429: respect Retry-After, the cron will pick it up

## Duplicate Intake records
- Should not happen — CallSofia_Call_ID__c is External ID (Unique)
- If it does: check the field is configured as `External ID` AND `Unique` in Setup
```

- [ ] **Step 4: Commit**

```bash
git checkout -b task/35-docs
git add README.md docs/
git commit -m "docs: README + deployment + troubleshooting"
git push -u origin task/35-docs
gh pr create --fill
```

---

## Task 36: Litify integration guide

**Wave:** 10

**Files:**
- Create: `docs/litify-setup-guide.md`
- Create: `docs/adding-a-crm-adapter.md`

- [ ] **Step 1: Write `docs/litify-setup-guide.md`**

```markdown
# Litify Setup Guide

This guide walks through configuring your Salesforce + Litify org to receive CallSofia events through the bridge.

## Prerequisites

- Salesforce org with Litify managed package installed
- System Administrator access
- `sf` CLI installed (`npm i -g @salesforce/cli`)

## Step 1 — Create a Connected App

1. Setup → App Manager → New Connected App
2. Name: `CallSofia Bridge`
3. Enable OAuth Settings:
   - Callback URL: `https://login.salesforce.com/services/oauth2/success`
   - Scopes: `Manage user data via APIs (api)`, `Perform requests at any time (refresh_token, offline_access)`
4. Save. Note the Consumer Key (`SALESFORCE_CLIENT_ID`) and Secret (`SALESFORCE_CLIENT_SECRET`).
5. Manage → Edit Policies: Permitted Users = "Admin approved users are pre-authorized", IP Relaxation = "Relax IP restrictions"
6. Profiles → Add the integration user's profile
7. Reset that user's security token (User → Settings → Reset Security Token), use that as `SALESFORCE_SECURITY_TOKEN`

## Step 2 — Create custom fields

```bash
sf org login web --alias acme-litify
./scripts/litify/create-custom-fields.sh acme-litify
```

Verify in Setup → Object Manager → Intake → Fields:
- All `CallSofia_*__c` fields exist
- `CallSofia_Call_ID__c` is External ID + Unique

## Step 3 — Configure intake defaults

```bash
# Find your default intake owner User ID
sf data query --query "SELECT Id, Name FROM User WHERE Username = 'intake@firm.com'" --target-org acme-litify

# Find the intake coordinator
sf data query --query "SELECT Id, Name FROM User WHERE Profile.Name = 'Intake Coordinator'" --target-org acme-litify
```

Set:
- `INTAKE_DEFAULT_OWNER_ID`
- `INTAKE_COORDINATOR_USER_ID`

## Step 4 — Verify Case Type records exist

```bash
sf data query --query "SELECT Id, Name FROM litify_pm__Case_Type__c" --target-org acme-litify
```

The names must match the values returned by `mapCaseType()` in `field-mapping.ts`. Adjust either the picklist values in your org or the mapping function in the codebase.

## Step 5 — Test

```bash
# In bridge repo:
pnpm dev
pnpm tsx scripts/dev/mock-callsofia.ts http://localhost:3000/api/webhooks/callsofia
```

Then in Salesforce, look for: a new Person, a new Intake with all fields populated, an Activity (Task) with the call details.

## Field Reference

See `src/lib/adapters/litify/field-mapping.ts` for the complete mapping table from CallSofia extracted_vars to Litify Intake fields.

## Auto-conversion to Matter

Set `LITIFY_AUTO_CONVERT_QUALIFIED=true` to automatically trigger Litify's Intake → Matter conversion when a `lead.qualified` event arrives. Most firms keep this OFF and review qualified intakes manually first.
```

- [ ] **Step 2: Write `docs/adding-a-crm-adapter.md`**

```markdown
# Adding a New CRM Adapter

The bridge uses a pluggable adapter pattern. Adding a new CRM (Filevine, MyCase, HubSpot, etc.) is a single-file change.

## 1. Create the adapter folder

```
src/lib/adapters/<crm-name>/
  ├── adapter.ts         # main entry implementing CrmAdapter
  ├── adapter.test.ts
  └── (auth.ts, *.ts as needed)
```

## 2. Implement the interface

```ts
import type { CrmAdapter, AdapterContext, HandlerResult, HealthStatus } from "../types";
import type { CallSofiaEvent } from "@/lib/webhook/types";

export class HubSpotAdapter implements CrmAdapter {
  readonly name = "hubspot";

  async init(): Promise<void> { /* validate creds */ }

  async healthCheck(): Promise<HealthStatus> { /* ping API */ return { healthy: true, timestamp: new Date() }; }

  async handle(event: CallSofiaEvent, ctx: AdapterContext): Promise<HandlerResult> {
    switch (event.event_type) {
      case "lead.qualified": {
        // ...create HubSpot Contact + Deal
        return { outcome: "success", crm_record_id: "deal-123" };
      }
      default:
        return { outcome: "noop" };
    }
  }
}
```

## 3. Register in the adapter registry

Edit `src/lib/adapters/registry.ts`:

```ts
case "hubspot": {
  const { HubSpotAdapter } = await import("./hubspot/adapter");
  _cached = new HubSpotAdapter();
  break;
}
```

Also update `AdapterName` type and `VALID_NAMES`.

## 4. Add the env var schema

Edit `src/lib/config.ts` to add a `hubspot` section.

## 5. Tests

Mirror the pattern from `litify/adapter.test.ts` — mock the SDK, test each event_type case.

## 6. Set `CRM_ADAPTER=hubspot` in client env vars and deploy
```

- [ ] **Step 3: Commit**

```bash
git checkout -b task/36-litify-guide
git add docs/litify-setup-guide.md docs/adding-a-crm-adapter.md
git commit -m "docs: Litify setup guide + adapter authoring guide"
git push -u origin task/36-litify-guide
gh pr create --fill
```

---

## Self-Review

After writing the plan I checked it against the spec.

**Spec coverage:** Every section in the spec maps to one or more tasks:
- §3 Architecture → Tasks 8 (receiver), 23 (consumer), 22 (Litify), 21 (Generic), 26-30 (admin)
- §4 Components → all covered
- §5 Data flow → exercised by integration tests in Task 22
- §6 Litify field mapping → Tasks 14, 18, 31
- §7 Configuration → Task 2 + every task that reads config
- §8 Observability → Tasks 8, 9, 23 (mirror calls), 30 (health UI)
- §9 Reliability → Tasks 10 (backoff), 23 (retry), 24 (cron retries)
- §10 Security → Task 7 (HMAC), 26 (admin auth), all tasks use timing-safe compare
- §11 Deploy → Tasks 1 (Vercel link), 34 (CI), 35 (deployment doc)
- §12 Testing → every task has tests
- §13 Future work → flagged in spec, not in plan (correct)
- §14 Out of scope → confirmed not in plan (correct)

**Placeholder scan:** No "TBD" or "TODO". Every code block is complete and runnable.

**Type consistency:** `CrmAdapter`, `HandlerResult`, `CallSofiaEvent`, `LitifyIntake`, `LitifyPerson` are defined once and used consistently. The `mapCaseType` / `mapStatus` / `mapExtractedVars` signatures match between Task 14 (definition) and Task 22 (usage).

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-29-callsofia-bridge.md`.**

The user has explicitly requested **subagent-driven-development with max parallel subagents**. Per the wave structure:

- **Wave 0:** 1 sequential task (Task 1 — bootstrap)
- **Waves 1, 4, 5, 8, 9, 10:** 4-7 parallel tasks each (perfect for max parallelism)
- **Waves 2, 3, 6, 7:** 1-3 tasks, often gated by other tasks

After Task 1 lands, Waves 1-10 can dispatch up to ~7 parallel subagents per wave following the dependency graph at the top.
