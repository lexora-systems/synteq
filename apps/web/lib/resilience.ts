import { isApiContractError, isApiRequestError } from "./api";

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function safeArray<T>(value: unknown, normalize: (item: unknown) => T | null): T[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const normalized = normalize(item);
    return normalized ? [normalized] : [];
  });
}

export function safeBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function safeNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

export function safeString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

export function safeNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function safeDateString(value: unknown, fallback = new Date().toISOString()): string {
  if (typeof value !== "string" || value.trim() === "") {
    return fallback;
  }
  return Number.isNaN(Date.parse(value)) ? fallback : value;
}

export function logServerLoadFailure(route: string, scope: string, error: unknown): void {
  if (isApiRequestError(error)) {
    console.warn(`${route}.load_failed`, {
      scope,
      status: error.status,
      code: error.code,
      requestId: error.requestId,
    });
    return;
  }

  if (isApiContractError(error)) {
    console.warn(`${route}.contract_invalid`, {
      scope,
      path: error.path,
      message: error.message,
    });
    return;
  }

  console.warn(`${route}.load_failed`, {
    scope,
    message: error instanceof Error ? error.message : "Unknown error",
  });
}
