import type { AppConfig } from "../config.js";

type PreflightResult = {
  ok: boolean;
  errors: string[];
};

const PLACEHOLDER_FRAGMENTS = [
  "replace-with",
  "change-me",
  "changeme",
  "example",
  "your-",
  "placeholder",
  "dev-only",
  "synteq.local"
];

function isProductionRuntime(config: AppConfig): boolean {
  return config.NODE_ENV === "production";
}

function isPlaceholderGrade(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return true;
  }

  return PLACEHOLDER_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

function validateSecret(
  errors: string[],
  name: string,
  value: string | undefined,
  options?: { minLength?: number }
) {
  const minLength = options?.minLength ?? 32;
  if (!value || value.trim().length === 0) {
    errors.push(`${name} must be set in production.`);
    return;
  }

  if (value.trim().length < minLength) {
    errors.push(`${name} must be at least ${minLength} characters in production.`);
  }

  if (isPlaceholderGrade(value)) {
    errors.push(`${name} looks placeholder-grade and is not allowed in production.`);
  }
}

function validateCorsOrigin(errors: string[], corsOrigin: string) {
  const origins = corsOrigin
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  if (origins.length === 0) {
    errors.push("CORS_ORIGIN must include at least one explicit origin in production.");
    return;
  }

  for (const origin of origins) {
    if (origin === "*") {
      errors.push("CORS_ORIGIN cannot be '*' in production.");
      continue;
    }

    if (/localhost|127\.0\.0\.1/i.test(origin)) {
      errors.push(`CORS_ORIGIN contains local-only origin "${origin}", which is not allowed in production.`);
    }
  }
}

export function validateProductionPreflight(config: AppConfig): PreflightResult {
  if (!isProductionRuntime(config)) {
    return {
      ok: true,
      errors: []
    };
  }

  const errors: string[] = [];

  if (!config.REDIS_REQUIRED) {
    errors.push("REDIS_REQUIRED must be true in production.");
  }

  if (!config.REDIS_URL) {
    errors.push("REDIS_URL must be set in production.");
  }

  if (!config.INGEST_HMAC_REQUIRED) {
    errors.push("INGEST_HMAC_REQUIRED must be true in production.");
  }

  if (config.EMAIL_DEV_MODE) {
    errors.push("EMAIL_DEV_MODE must be false in production.");
  }

  validateCorsOrigin(errors, config.CORS_ORIGIN);
  validateSecret(errors, "JWT_SECRET", config.JWT_SECRET, { minLength: 32 });
  validateSecret(errors, "SYNTEQ_API_KEY_SALT", config.SYNTEQ_API_KEY_SALT, { minLength: 32 });
  validateSecret(errors, "INGEST_HMAC_SECRET", config.INGEST_HMAC_SECRET, { minLength: 32 });
  validateSecret(errors, "PUBSUB_PUSH_SHARED_SECRET", config.PUBSUB_PUSH_SHARED_SECRET, { minLength: 32 });
  validateSecret(errors, "DASHBOARD_ADMIN_PASSWORD", config.DASHBOARD_ADMIN_PASSWORD, { minLength: 14 });
  validateSecret(errors, "BREVO_API_KEY", config.BREVO_API_KEY, { minLength: 20 });

  if (!config.PUBSUB_PROJECT_ID) {
    errors.push("PUBSUB_PROJECT_ID must be set in production.");
  }

  if (!config.PUBSUB_TOPIC_INGEST) {
    errors.push("PUBSUB_TOPIC_INGEST must be set in production. Direct BigQuery ingest fallback is disabled by policy.");
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

export function assertProductionPreflight(config: AppConfig): void {
  const result = validateProductionPreflight(config);
  if (result.ok) {
    return;
  }

  const message = [
    `Production preflight failed with ${result.errors.length} configuration issue(s):`,
    ...result.errors.map((error) => `- ${error}`),
    "Update environment variables and restart the API."
  ].join("\n");

  throw new Error(message);
}
