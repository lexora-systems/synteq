import type { AppConfig } from "../config.js";

type PreflightResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

type HardeningFlagName =
  | "REDIS_REQUIRED"
  | "INGEST_HMAC_REQUIRED"
  | "STRICT_CORS"
  | "REQUIRE_WEB_BASE_URL"
  | "ENFORCE_PUBSUB_ONLY";

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

function collectCorsOriginIssues(corsOrigin: string): string[] {
  const issues: string[] = [];
  const origins = corsOrigin
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  if (origins.length === 0) {
    issues.push("CORS_ORIGIN should include at least one explicit origin in production.");
    return issues;
  }

  for (const origin of origins) {
    if (origin === "*") {
      issues.push("CORS_ORIGIN is '*' in production; set explicit origins to reduce cross-origin exposure.");
      continue;
    }

    if (/localhost|127\.0\.0\.1/i.test(origin)) {
      issues.push(`CORS_ORIGIN contains local-only origin "${origin}" in production.`);
    }
  }

  return issues;
}

function hardeningFlagModes(config: AppConfig): Array<{
  flag: HardeningFlagName;
  enforced: boolean;
  deferredDetail: string;
}> {
  return [
    {
      flag: "REDIS_REQUIRED",
      enforced: config.REDIS_REQUIRED,
      deferredDetail: "Redis fallback remains enabled."
    },
    {
      flag: "INGEST_HMAC_REQUIRED",
      enforced: config.INGEST_HMAC_REQUIRED,
      deferredDetail: "Unsigned ingestion payloads are still accepted."
    },
    {
      flag: "STRICT_CORS",
      enforced: config.STRICT_CORS,
      deferredDetail: "Permissive CORS origin configuration is still allowed."
    },
    {
      flag: "REQUIRE_WEB_BASE_URL",
      enforced: config.REQUIRE_WEB_BASE_URL,
      deferredDetail: "WEB_BASE_URL remains warning-only."
    },
    {
      flag: "ENFORCE_PUBSUB_ONLY",
      enforced: config.ENFORCE_PUBSUB_ONLY,
      deferredDetail: "Direct BigQuery ingest fallback remains enabled."
    }
  ];
}

function logHardeningFlagModes(config: AppConfig) {
  if (!isProductionRuntime(config)) {
    return;
  }

  for (const mode of hardeningFlagModes(config)) {
    if (mode.enforced) {
      console.info({
        event: "hardening_enforced",
        flag: mode.flag,
        node_env: config.NODE_ENV
      });
      continue;
    }

    console.warn({
      event: "hardening_deferred",
      flag: mode.flag,
      node_env: config.NODE_ENV,
      detail: mode.deferredDetail
    });
  }
}

export function validateProductionPreflight(config: AppConfig): PreflightResult {
  if (!isProductionRuntime(config)) {
    return {
      ok: true,
      errors: [],
      warnings: []
    };
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config.REDIS_REQUIRED) {
    warnings.push("REDIS_REQUIRED is false in production; Redis outages can fall back to in-memory state.");
  } else if (!config.REDIS_URL) {
    errors.push("REDIS_URL must be set when REDIS_REQUIRED=true in production.");
  }

  if (!config.REDIS_URL) {
    warnings.push("REDIS_URL is not set in production; distributed limits/dedupe/cache are disabled.");
  }

  if (!config.INGEST_HMAC_REQUIRED) {
    warnings.push("INGEST_HMAC_REQUIRED is false in production; ingestion endpoint accepts unsigned payloads.");
  }

  if (config.EMAIL_DEV_MODE) {
    warnings.push("EMAIL_DEV_MODE is true in production; emails are logged and not delivered.");
  }

  const corsIssues = collectCorsOriginIssues(config.CORS_ORIGIN);
  if (config.STRICT_CORS) {
    errors.push(...corsIssues.map((issue) => `[STRICT_CORS] ${issue}`));
  } else {
    warnings.push(...corsIssues);
    if (corsIssues.length > 0) {
      warnings.push("STRICT_CORS is false in production; permissive CORS origins are currently allowed.");
    }
  }

  validateSecret(errors, "JWT_SECRET", config.JWT_SECRET, { minLength: 32 });
  validateSecret(errors, "SYNTEQ_API_KEY_SALT", config.SYNTEQ_API_KEY_SALT, { minLength: 32 });
  validateSecret(errors, "SCHEDULER_SHARED_SECRET", config.SCHEDULER_SHARED_SECRET, { minLength: 32 });
  validateSecret(errors, "PUBSUB_PUSH_SHARED_SECRET", config.PUBSUB_PUSH_SHARED_SECRET, { minLength: 32 });
  validateSecret(errors, "DASHBOARD_ADMIN_PASSWORD", config.DASHBOARD_ADMIN_PASSWORD, { minLength: 14 });

  if (config.REQUIRE_WEB_BASE_URL) {
    if (!config.WEB_BASE_URL) {
      errors.push("[REQUIRE_WEB_BASE_URL] WEB_BASE_URL must be set in production.");
    } else if (/localhost|127\.0\.0\.1/i.test(config.WEB_BASE_URL)) {
      errors.push("[REQUIRE_WEB_BASE_URL] WEB_BASE_URL cannot point to localhost in production.");
    }
  } else if (!config.WEB_BASE_URL) {
    warnings.push("WEB_BASE_URL is not set in production; email links fall back to CORS_ORIGIN.");
  } else if (/localhost|127\.0\.0\.1/i.test(config.WEB_BASE_URL)) {
    warnings.push("WEB_BASE_URL points to localhost in production.");
  }

  if (config.INGEST_HMAC_REQUIRED) {
    validateSecret(errors, "INGEST_HMAC_SECRET", config.INGEST_HMAC_SECRET, { minLength: 32 });
  } else if (!config.INGEST_HMAC_SECRET) {
    warnings.push("INGEST_HMAC_SECRET is not set in production.");
  }

  if (!config.EMAIL_DEV_MODE) {
    validateSecret(errors, "BREVO_API_KEY", config.BREVO_API_KEY, { minLength: 20 });
  }

  if (config.ENFORCE_PUBSUB_ONLY) {
    if (!config.PUBSUB_PROJECT_ID) {
      errors.push("[ENFORCE_PUBSUB_ONLY] PUBSUB_PROJECT_ID must be set in production.");
    }

    if (!config.PUBSUB_TOPIC_INGEST) {
      errors.push("[ENFORCE_PUBSUB_ONLY] PUBSUB_TOPIC_INGEST must be set in production.");
    }
  } else {
    if (!config.PUBSUB_PROJECT_ID) {
      warnings.push("PUBSUB_PROJECT_ID is not set in production.");
    }

    if (!config.PUBSUB_TOPIC_INGEST) {
      warnings.push("PUBSUB_TOPIC_INGEST is not set in production; ingestion uses direct BigQuery fallback.");
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}

export function assertProductionPreflight(config: AppConfig): void {
  logHardeningFlagModes(config);

  const result = validateProductionPreflight(config);
  if (result.warnings.length > 0) {
    console.warn(
      [
        `Production preflight warnings (${result.warnings.length}):`,
        ...result.warnings.map((warning) => `- ${warning}`)
      ].join("\n")
    );
  }

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
