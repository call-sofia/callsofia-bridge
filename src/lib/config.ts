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
