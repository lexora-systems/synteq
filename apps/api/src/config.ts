import "dotenv/config";
import { z } from "zod";

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

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1),
  BIGQUERY_PROJECT_ID: z.string().min(1),
  BIGQUERY_DATASET: z.string().default("synteq"),
  BIGQUERY_KEY_JSON: z.string().optional(),
  BIGQUERY_AGG_LOOKBACK_MINUTES: z.coerce.number().int().positive().max(1440).default(15),
  PUBSUB_PROJECT_ID: z.string().optional(),
  PUBSUB_TOPIC_INGEST: z.string().optional(),
  PUBSUB_PUSH_SHARED_SECRET: z.string().min(16).optional(),
  ENABLE_SECRET_MANAGER: envBoolean,
  SYNTEQ_API_KEY_SALT: z.string().min(16),
  INGEST_HMAC_SECRET: z.string().min(16).optional(),
  INGEST_HMAC_REQUIRED: envBoolean,
  INGEST_SIGNATURE_MAX_SKEW_SEC: z.coerce.number().int().positive().max(3600).default(300),
  INGEST_DEDUPE_TTL_SEC: z.coerce.number().int().positive().max(86400).default(900),
  INGEST_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().max(20000).default(600),
  MAX_INGEST_BODY_BYTES: z.coerce.number().int().positive().max(10_000_000).default(262_144),
  SLACK_DEFAULT_WEBHOOK_URL: z.string().url().optional(),
  JWT_SECRET: z.string().min(16),
  DASHBOARD_ADMIN_EMAIL: z.string().email(),
  DASHBOARD_ADMIN_PASSWORD: z.string().min(8),
  DEFAULT_TENANT_ID: z.string().optional(),
  CORS_ORIGIN: z.string().default("*"),
  METRICS_CACHE_TTL_SEC: z.coerce.number().int().positive().max(300).default(45),
  INCIDENT_ESCALATION_MINUTES: z.coerce.number().int().positive().max(10080).default(20),
  INCIDENT_COOLDOWN_WINDOWS: z.coerce.number().int().positive().max(20).default(3)
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const message = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  throw new Error(`Invalid environment variables: ${message}`);
}

export const config = parsed.data;
