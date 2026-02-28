const MAX_ERROR = 1024;
const MAX_PAYLOAD = 8192;

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

export function sanitizePayload(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "string") {
    return sanitizeText(value, MAX_PAYLOAD);
  }

  try {
    const encoded = JSON.stringify(value);
    return sanitizeText(encoded, MAX_PAYLOAD);
  } catch {
    return undefined;
  }
}
