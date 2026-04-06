import "dotenv/config";
import { z } from "zod";

const emptyToUndefined = (value: unknown) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

const envBoolean = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((value) => {
    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value !== "string") {
      return false;
    }

    return value.toLowerCase() === "true" || value === "1";
  });

const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: optionalString,
  REDIS_REQUIRED: envBoolean.default(false),
  REDIS_KEY_PREFIX: z.string().default("synteq"),
  BIGQUERY_PROJECT_ID: z.string().min(1),
  BIGQUERY_DATASET: z.string().default("synteq"),
  BIGQUERY_KEY_JSON: optionalString,
  BIGQUERY_AGG_LOOKBACK_MINUTES: z.coerce.number().int().positive().max(1440).default(15),
  PUBSUB_PROJECT_ID: optionalString,
  PUBSUB_TOPIC_INGEST: optionalString,
  PUBSUB_PUSH_SHARED_SECRET: z.preprocess(emptyToUndefined, z.string().min(16).optional()),
  SCHEDULER_SHARED_SECRET: z.preprocess(emptyToUndefined, z.string().min(16).optional()),
  ENABLE_SECRET_MANAGER: envBoolean,
  SYNTEQ_API_KEY_SALT: z.string().min(16),
  INGEST_HMAC_SECRET: z.preprocess(emptyToUndefined, z.string().min(16).optional()),
  INGEST_HMAC_REQUIRED: envBoolean.default(false),
  STRICT_CORS: envBoolean.default(false),
  REQUIRE_WEB_BASE_URL: envBoolean.default(false),
  ENFORCE_PUBSUB_ONLY: envBoolean.default(false),
  INGEST_SIGNATURE_MAX_SKEW_SEC: z.coerce.number().int().positive().max(3600).default(300),
  INGEST_DEDUPE_TTL_SEC: z.coerce.number().int().positive().max(86400).default(900),
  INGEST_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().max(20000).default(600),
  MAX_INGEST_BODY_BYTES: z.coerce.number().int().positive().max(10_000_000).default(262_144),
  SLACK_DEFAULT_WEBHOOK_URL: optionalUrl,
  JWT_SECRET: z.string().min(16),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL: z.string().default("30d"),
  BREVO_API_KEY: optionalString,
  EMAIL_DEV_MODE: envBoolean,
  DASHBOARD_ADMIN_EMAIL: z.string().email(),
  DASHBOARD_ADMIN_PASSWORD: z.string().min(8),
  DEFAULT_TENANT_ID: optionalString,
  ALLOW_PUBLIC_SIGNUP: envBoolean.default(true),
  CORS_ORIGIN: z.string().default("*"),
  WEB_BASE_URL: z.string().url().optional(),
  INVITE_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().max(10000).default(20),
  INVITE_PER_EMAIL_PER_DAY: z.coerce.number().int().positive().max(1000).default(3),
  AUTH_LOGIN_MAX_ATTEMPTS_PER_IP: z.coerce.number().int().positive().max(10000).default(10),
  AUTH_LOGIN_MAX_ATTEMPTS_PER_EMAIL: z.coerce.number().int().positive().max(10000).default(5),
  AUTH_LOGIN_WINDOW_SEC: z.coerce.number().int().positive().max(86400).default(900),
  AUTH_LOGIN_LOCKOUT_SEC: z.coerce.number().int().positive().max(86400).default(900),
  LOGOUT_ALL_ENABLED: envBoolean.default(true),
  METRICS_CACHE_TTL_SEC: z.coerce.number().int().positive().max(300).default(45),
  INCIDENT_ESCALATION_MINUTES: z.coerce.number().int().positive().max(10080).default(20),
  INCIDENT_COOLDOWN_WINDOWS: z.coerce.number().int().positive().max(20).default(3),
  ALERT_DISPATCH_MAX_RETRIES: z.coerce.number().int().nonnegative().max(20).default(3),
  ALERT_DISPATCH_BACKOFF_BASE_SEC: z.coerce.number().int().positive().max(86400).default(30),
  FX_RATE_USD: z.coerce.number().positive().default(1),
  FX_RATE_PHP: z.coerce.number().positive().default(56),
  FX_RATE_EUR: z.coerce.number().positive().default(0.92),
  FX_RATE_GBP: z.coerce.number().positive().default(0.79),
  FX_RATE_JPY: z.coerce.number().positive().default(150),
  FX_RATE_AUD: z.coerce.number().positive().default(1.53),
  FX_RATE_CAD: z.coerce.number().positive().default(1.36)
});

export type AppConfig = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const message = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  throw new Error(`Invalid environment variables: ${message}`);
}

if (parsed.data.REDIS_REQUIRED && !parsed.data.REDIS_URL) {
  throw new Error("Invalid environment variables: REDIS_URL is required when REDIS_REQUIRED=true");
}

export const config = parsed.data;
