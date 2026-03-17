import { prisma } from "../lib/prisma.js";
import { sha256 } from "../utils/crypto.js";
import { sanitizeErrorMessage, sanitizeText } from "../utils/sanitize.js";
import type { NormalizedOperationalEvent } from "./operational-event-ingestion-service.js";

const PROCESSING_TTL_SEC = 300;

type EventIdempotencyClient = {
  eventIdempotencyLedger: {
    create: (args: Record<string, unknown>) => Promise<unknown>;
    findUnique: (args: Record<string, unknown>) => Promise<{
      id: string;
      status: "processing" | "completed" | "failed";
      lock_expires_at: Date | null;
      seen_count: number;
      attempt_count: number;
      operational_event_id: string | null;
    } | null>;
    update: (args: Record<string, unknown>) => Promise<unknown>;
    updateMany: (args: Record<string, unknown>) => Promise<{ count: number }>;
  };
};

export type IdempotencyHint = {
  upstreamKey?: string;
  namespace?: string;
};

export type IdempotencyReservationOutcome =
  | { action: "reserved" | "recovered_failed" | "recovered_stale_processing"; idempotencyKey: string }
  | { action: "duplicate_completed"; idempotencyKey: string; operationalEventId?: string | null }
  | { action: "duplicate_inflight"; idempotencyKey: string };

function canonicalize(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(",")}}`;
  }

  return JSON.stringify(String(value));
}

export function buildOperationalEventIdempotencyKey(input: {
  tenantId: string;
  source: string;
  event: NormalizedOperationalEvent;
  hint?: IdempotencyHint;
}) {
  // Trusted upstream delivery identifiers can be used as primary dedupe hints.
  if (input.hint?.upstreamKey) {
    const namespace = sanitizeText(input.hint.namespace ?? "upstream", 64) ?? "upstream";
    return sha256(
      `tenant=${input.tenantId}|source=${input.source}|ns=${namespace}|key=${sanitizeText(input.hint.upstreamKey, 256) ?? input.hint.upstreamKey}`
    );
  }

  // Fallback deterministic fingerprint from normalized event fields.
  const material = {
    source: input.source,
    event_type: input.event.event_type,
    system: input.event.system,
    service: input.event.service,
    environment: input.event.environment,
    event_ts: input.event.event_ts.toISOString(),
    severity: input.event.severity,
    correlation_key: input.event.correlation_key,
    metadata: input.event.metadata_json
  };

  return sha256(`tenant=${input.tenantId}|${canonicalize(material)}`);
}

function nextLockExpiry(now: Date) {
  return new Date(now.getTime() + PROCESSING_TTL_SEC * 1000);
}

export async function reserveEventIdempotency(input: {
  tenantId: string;
  source: string;
  idempotencyKey: string;
  now?: Date;
  client?: EventIdempotencyClient;
}): Promise<IdempotencyReservationOutcome> {
  const now = input.now ?? new Date();
  const client = input.client ?? (prisma as unknown as EventIdempotencyClient);
  const uniqueWhere = {
    tenant_id_source_idempotency_key: {
      tenant_id: input.tenantId,
      source: input.source,
      idempotency_key: input.idempotencyKey
    }
  };

  let entry = await client.eventIdempotencyLedger.findUnique({
    where: uniqueWhere
  });

  if (!entry) {
    try {
      await client.eventIdempotencyLedger.create({
        data: {
          tenant_id: input.tenantId,
          source: input.source,
          idempotency_key: input.idempotencyKey,
          status: "processing",
          first_seen_at: now,
          last_seen_at: now,
          lock_expires_at: nextLockExpiry(now),
          seen_count: 1,
          attempt_count: 1
        }
      });
      return {
        action: "reserved",
        idempotencyKey: input.idempotencyKey
      };
    } catch {
      entry = await client.eventIdempotencyLedger.findUnique({
        where: uniqueWhere
      });
    }
  }

  if (!entry) {
    return {
      action: "duplicate_inflight",
      idempotencyKey: input.idempotencyKey
    };
  }

  if (entry.status === "completed") {
    await client.eventIdempotencyLedger.update({
      where: uniqueWhere,
      data: {
        last_seen_at: now,
        seen_count: {
          increment: 1
        }
      }
    });
    return {
      action: "duplicate_completed",
      idempotencyKey: input.idempotencyKey,
      operationalEventId: entry.operational_event_id
    };
  }

  if (entry.status === "failed") {
    const claimed = await client.eventIdempotencyLedger.updateMany({
      where: {
        ...uniqueWhere.tenant_id_source_idempotency_key,
        status: "failed"
      },
      data: {
        status: "processing",
        last_seen_at: now,
        lock_expires_at: nextLockExpiry(now),
        completed_at: null,
        error_code: null,
        error_message: null,
        attempt_count: {
          increment: 1
        },
        seen_count: {
          increment: 1
        }
      }
    });
    if (claimed.count > 0) {
      return {
        action: "recovered_failed",
        idempotencyKey: input.idempotencyKey
      };
    }
  }

  if (entry.status === "processing") {
    const stale = !entry.lock_expires_at || entry.lock_expires_at.getTime() <= now.getTime();
    if (!stale) {
      await client.eventIdempotencyLedger.update({
        where: uniqueWhere,
        data: {
          last_seen_at: now,
          seen_count: {
            increment: 1
          }
        }
      });
      return {
        action: "duplicate_inflight",
        idempotencyKey: input.idempotencyKey
      };
    }

    const claimed = await client.eventIdempotencyLedger.updateMany({
      where: {
        ...uniqueWhere.tenant_id_source_idempotency_key,
        status: "processing",
        OR: [{ lock_expires_at: null }, { lock_expires_at: { lte: now } }]
      },
      data: {
        status: "processing",
        last_seen_at: now,
        lock_expires_at: nextLockExpiry(now),
        attempt_count: {
          increment: 1
        },
        seen_count: {
          increment: 1
        },
        error_code: null,
        error_message: null
      }
    });

    if (claimed.count > 0) {
      return {
        action: "recovered_stale_processing",
        idempotencyKey: input.idempotencyKey
      };
    }
  }

  return {
    action: "duplicate_inflight",
    idempotencyKey: input.idempotencyKey
  };
}

export async function markEventIdempotencyCompleted(input: {
  tenantId: string;
  source: string;
  idempotencyKey: string;
  operationalEventId: string;
  now?: Date;
  client?: EventIdempotencyClient;
}) {
  const now = input.now ?? new Date();
  const client = input.client ?? (prisma as unknown as EventIdempotencyClient);
  await client.eventIdempotencyLedger.update({
    where: {
      tenant_id_source_idempotency_key: {
        tenant_id: input.tenantId,
        source: input.source,
        idempotency_key: input.idempotencyKey
      }
    },
    data: {
      status: "completed",
      completed_at: now,
      last_seen_at: now,
      lock_expires_at: null,
      error_code: null,
      error_message: null,
      operational_event_id: input.operationalEventId
    }
  });
}

export async function markEventIdempotencyFailed(input: {
  tenantId: string;
  source: string;
  idempotencyKey: string;
  errorCode: string;
  errorMessage?: string;
  now?: Date;
  client?: EventIdempotencyClient;
}) {
  const now = input.now ?? new Date();
  const client = input.client ?? (prisma as unknown as EventIdempotencyClient);
  await client.eventIdempotencyLedger.update({
    where: {
      tenant_id_source_idempotency_key: {
        tenant_id: input.tenantId,
        source: input.source,
        idempotency_key: input.idempotencyKey
      }
    },
    data: {
      status: "failed",
      completed_at: null,
      lock_expires_at: null,
      last_seen_at: now,
      error_code: sanitizeText(input.errorCode, 64) ?? "INGEST_ERROR",
      error_message: sanitizeErrorMessage(input.errorMessage) ?? null
    }
  });
}
