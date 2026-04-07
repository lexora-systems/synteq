import { blockedMetadataKeyPatterns, payloadSignalSnapshotKeys } from "../lib/data-contract.js";

const MAX_ERROR = 1024;
const MAX_PAYLOAD = 8192;
const MAX_METADATA_TEXT = 512;
const MAX_METADATA_KEYS = 48;
const MAX_METADATA_ARRAY_ITEMS = 24;
const MAX_METADATA_DEPTH = 4;

export function sanitizeText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) {
    return undefined;
  }

  const clean = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (!clean) {
    return undefined;
  }

  return clean.length <= maxLength ? clean : clean.slice(0, maxLength);
}

export function sanitizeErrorMessage(value: string | undefined): string | undefined {
  return sanitizeText(value, MAX_ERROR);
}

function isBlockedMetadataKey(key: string): boolean {
  return blockedMetadataKeyPatterns.some((pattern) => pattern.test(key));
}

function sanitizeMetadataValue(value: unknown, depth: number): unknown {
  if (depth > MAX_METADATA_DEPTH) {
    return undefined;
  }

  if (typeof value === "string") {
    return sanitizeText(value, MAX_METADATA_TEXT);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return Number.isFinite(value as number) || typeof value === "boolean" ? value : undefined;
  }

  if (value === null) {
    return null;
  }

  if (Array.isArray(value)) {
    const cleanedItems = value
      .slice(0, MAX_METADATA_ARRAY_ITEMS)
      .map((item) => sanitizeMetadataValue(item, depth + 1))
      .filter((item) => item !== undefined);
    return cleanedItems.length > 0 ? cleanedItems : undefined;
  }

  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [rawKey, rawValue] of Object.entries(input).slice(0, MAX_METADATA_KEYS)) {
      const key = sanitizeText(rawKey, 128);
      if (!key || isBlockedMetadataKey(key)) {
        continue;
      }
      const cleanedValue = sanitizeMetadataValue(rawValue, depth + 1);
      if (cleanedValue !== undefined) {
        output[key] = cleanedValue;
      }
    }
    return Object.keys(output).length > 0 ? output : undefined;
  }

  return undefined;
}

export function sanitizeOperationalMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const cleaned = sanitizeMetadataValue(value, 0);
  if (!cleaned || typeof cleaned !== "object" || Array.isArray(cleaned)) {
    return {};
  }

  return cleaned as Record<string, unknown>;
}

function buildPayloadSignalSnapshot(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const snapshot: Record<string, unknown> = {};
  for (const key of payloadSignalSnapshotKeys) {
    const raw = record[key];
    if (typeof raw === "string") {
      const cleaned = sanitizeText(raw, 120);
      if (cleaned) {
        snapshot[key] = cleaned;
      }
      continue;
    }

    if (typeof raw === "number" && Number.isFinite(raw)) {
      snapshot[key] = raw;
      continue;
    }

    if (typeof raw === "boolean") {
      snapshot[key] = raw;
    }
  }

  const nested = record.payload;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const nestedRecord = nested as Record<string, unknown>;
    for (const key of payloadSignalSnapshotKeys) {
      if (snapshot[key] !== undefined) {
        continue;
      }
      const nestedRaw = nestedRecord[key];
      if (typeof nestedRaw === "string") {
        const cleaned = sanitizeText(nestedRaw, 120);
        if (cleaned) {
          snapshot[key] = cleaned;
        }
        continue;
      }
      if (typeof nestedRaw === "number" && Number.isFinite(nestedRaw)) {
        snapshot[key] = nestedRaw;
        continue;
      }
      if (typeof nestedRaw === "boolean") {
        snapshot[key] = nestedRaw;
      }
    }
  }

  return Object.keys(snapshot).length > 0 ? snapshot : undefined;
}

export function sanitizePayload(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "string") {
    // Do not persist raw log-like payload strings by default.
    return undefined;
  }

  const snapshot = buildPayloadSignalSnapshot(value);
  if (!snapshot) {
    return undefined;
  }

  try {
    const encoded = JSON.stringify(snapshot);
    return sanitizeText(encoded, MAX_PAYLOAD);
  } catch {
    return undefined;
  }
}
