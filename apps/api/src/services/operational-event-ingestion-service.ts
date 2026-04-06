import type { Prisma } from "@prisma/client";
import type { IngestOperationalEventInput, IngestOperationalEventsRequest } from "@synteq/shared";
import { prisma } from "../lib/prisma.js";
import { runtimeMetrics } from "../lib/runtime-metrics.js";
import { sanitizeText } from "../utils/sanitize.js";
import {
  buildOperationalEventIdempotencyKey,
  markEventIdempotencyFailed,
  reserveEventIdempotency,
  type IdempotencyHint
} from "./event-idempotency-service.js";
import {
  handoffOperationalEventsForAnalysis,
  type OperationalEventAnalysisHandoff,
  type OperationalEventForAnalysis
} from "./operational-event-analysis-hook-service.js";
import {
  assertOperationalSourceOwnership,
  type OperationalSourceOwner
} from "./ingest-source-ownership-service.js";

type OperationalEventSeverity = "warn" | "low" | "medium" | "high" | "critical";

export type NormalizedOperationalEvent = {
  source: string;
  event_type: string;
  service: string | null;
  system: string;
  environment: string | null;
  event_ts: Date;
  severity: OperationalEventSeverity | null;
  correlation_key: string | null;
  metadata_json: Prisma.InputJsonValue;
};

export type IngestOperationalEventsResult = {
  accepted: number;
  ingested: number;
  duplicates: number;
  skipped: number;
  failed: number;
  persisted: number;
  analysis_handoff: OperationalEventAnalysisHandoff;
};

function normalizeMetadata(event: IngestOperationalEventInput): Prisma.InputJsonValue {
  const metadata = event.metadata ?? {};
  const attributes = event.attributes ?? {};
  const merged = {
    ...metadata,
    ...attributes
  };
  return merged as Prisma.InputJsonValue;
}

function normalizeTag(value: string | undefined, maxLength: number): string | undefined {
  const clean = sanitizeText(value, maxLength);
  return clean ? clean.toLowerCase() : undefined;
}

export function normalizeOperationalEvent(event: IngestOperationalEventInput): NormalizedOperationalEvent {
  const service = sanitizeText(event.service, 191) ?? null;
  const system = sanitizeText(event.system ?? event.service, 191);
  if (!system) {
    throw new Error("Missing system after normalization");
  }

  return {
    source: normalizeTag(event.source, 64) ?? event.source.toLowerCase(),
    event_type: normalizeTag(event.event_type, 128) ?? event.event_type.toLowerCase(),
    service,
    system,
    environment: normalizeTag(event.environment, 64) ?? null,
    event_ts: event.timestamp instanceof Date ? event.timestamp : new Date(event.timestamp),
    severity: event.severity ?? null,
    correlation_key: sanitizeText(event.correlation_key, 191) ?? null,
    metadata_json: normalizeMetadata(event)
  };
}

function buildAnalysisPayload(events: NormalizedOperationalEvent[]): OperationalEventForAnalysis[] {
  return events.map((event) => ({
    source: event.source,
    eventType: event.event_type,
    system: event.system,
    eventTs: event.event_ts,
    severity: event.severity
  }));
}

export async function ingestOperationalEvents(
  request: IngestOperationalEventsRequest,
  context: {
    tenantId: string;
    apiKeyId?: string;
    requestId: string;
    idempotencyHints?: Array<IdempotencyHint | undefined>;
    sourceOwner?: OperationalSourceOwner;
  }
): Promise<IngestOperationalEventsResult> {
  const normalizedEvents = request.events.map((event) => normalizeOperationalEvent(event));
  if (normalizedEvents.length === 0) {
    throw new Error("No events supplied");
  }

  if (context.sourceOwner) {
    await assertOperationalSourceOwnership({
      tenantId: context.tenantId,
      sourceValues: normalizedEvents.map((event) => event.source),
      owner: context.sourceOwner
    });
  }

  let ingested = 0;
  let duplicates = 0;
  let skipped = 0;
  let failed = 0;
  const ingestedEvents: NormalizedOperationalEvent[] = [];

  for (const [index, event] of normalizedEvents.entries()) {
    const idempotencyKey = buildOperationalEventIdempotencyKey({
      tenantId: context.tenantId,
      source: event.source,
      event,
      hint: context.idempotencyHints?.[index]
    });

    const reservation = await reserveEventIdempotency({
      tenantId: context.tenantId,
      source: event.source,
      idempotencyKey
    });

    if (reservation.action === "duplicate_completed") {
      duplicates += 1;
      runtimeMetrics.increment("ingest_operational_duplicate_total");
      continue;
    }

    if (reservation.action === "duplicate_inflight") {
      skipped += 1;
      runtimeMetrics.increment("ingest_operational_inflight_total");
      continue;
    }

    try {
      const created = await prisma.$transaction(async (tx) => {
        const createdEvent = await tx.operationalEvent.create({
          data: {
            tenant_id: context.tenantId,
            source: event.source,
            event_type: event.event_type,
            service: event.service,
            system: event.system,
            environment: event.environment,
            event_ts: event.event_ts,
            severity: event.severity,
            correlation_key: event.correlation_key,
            metadata_json: event.metadata_json,
            request_id: context.requestId,
            api_key_id: context.apiKeyId ?? null
          },
          select: {
            id: true
          }
        });

        await tx.eventIdempotencyLedger.update({
          where: {
            tenant_id_source_idempotency_key: {
              tenant_id: context.tenantId,
              source: event.source,
              idempotency_key: idempotencyKey
            }
          },
          data: {
            status: "completed",
            completed_at: new Date(),
            last_seen_at: new Date(),
            lock_expires_at: null,
            error_code: null,
            error_message: null,
            operational_event_id: createdEvent.id
          }
        });

        return createdEvent;
      });

      if (created?.id) {
        ingested += 1;
        ingestedEvents.push(event);
      }
    } catch (error) {
      failed += 1;
      await markEventIdempotencyFailed({
        tenantId: context.tenantId,
        source: event.source,
        idempotencyKey,
        errorCode: "PERSIST_FAILED",
        errorMessage: error instanceof Error ? error.message : "unknown_error"
      });
      runtimeMetrics.increment("ingest_operational_failed_total");
    }
  }

  runtimeMetrics.increment("ingest_operational_persisted_total", ingested);

  const analysis_handoff = await handoffOperationalEventsForAnalysis({
    tenantId: context.tenantId,
    requestId: context.requestId,
    events: buildAnalysisPayload(ingestedEvents)
  });

  return {
    accepted: normalizedEvents.length,
    ingested,
    duplicates,
    skipped,
    failed,
    persisted: ingested,
    analysis_handoff
  };
}
