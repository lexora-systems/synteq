#!/usr/bin/env node

const canonicalApiBaseUrl = process.env.SYNTEQ_WEB_API_BASE_URL?.trim();
const apiBaseUrlFallback = process.env.API_BASE_URL?.trim();
const publicApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();

const errors = [];
const warnings = [];

function parseUrl(value, key) {
  try {
    return new URL(value);
  } catch {
    errors.push(`${key} must be a valid absolute URL.`);
    return null;
  }
}

if (!canonicalApiBaseUrl) {
  errors.push("SYNTEQ_WEB_API_BASE_URL is required.");
}

const parsedCanonicalUrl = canonicalApiBaseUrl ? parseUrl(canonicalApiBaseUrl, "SYNTEQ_WEB_API_BASE_URL") : null;
const productionLikeMode = process.env.NODE_ENV === "production";

if (parsedCanonicalUrl) {
  const isLocalhost = parsedCanonicalUrl.hostname === "localhost" || parsedCanonicalUrl.hostname === "127.0.0.1";
  if (productionLikeMode && parsedCanonicalUrl.protocol !== "https:") {
    errors.push("SYNTEQ_WEB_API_BASE_URL must use https in production mode.");
  }
  if (productionLikeMode && isLocalhost) {
    errors.push("SYNTEQ_WEB_API_BASE_URL cannot point to localhost in production mode.");
  }
}

if (!apiBaseUrlFallback) {
  warnings.push("API_BASE_URL is unset. This is allowed, but keep it aligned for legacy compatibility.");
} else if (canonicalApiBaseUrl && apiBaseUrlFallback !== canonicalApiBaseUrl) {
  warnings.push("API_BASE_URL differs from SYNTEQ_WEB_API_BASE_URL. Align both values before rollout.");
}

if (!publicApiBaseUrl) {
  warnings.push("NEXT_PUBLIC_API_BASE_URL is unset. This is allowed, but keep it aligned for client-side consistency.");
} else if (canonicalApiBaseUrl && publicApiBaseUrl !== canonicalApiBaseUrl) {
  warnings.push("NEXT_PUBLIC_API_BASE_URL differs from SYNTEQ_WEB_API_BASE_URL. Align both values before rollout.");
}

if (warnings.length > 0) {
  console.warn("[cloudflare-web-prep] warnings:");
  for (const warning of warnings) {
    console.warn(`- ${warning}`);
  }
}

if (errors.length > 0) {
  console.error("[cloudflare-web-prep] errors:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("[cloudflare-web-prep] environment check passed.");
