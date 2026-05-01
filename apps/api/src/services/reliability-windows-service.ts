import { prisma } from "../lib/prisma.js";

export type ReliabilityWindowState = "healthy" | "degraded" | "failing" | "unknown";
export type ReliabilityWindowLabel = "1h" | "24h" | "7d";

export type ReliabilityWindows = {
  generatedAt: string;
  scope: {
    tenantId?: string;
    workflowId: string | null;
    sourceId: string | null;
    sourceKey: string | null;
  };
  windows: Array<{
    label: ReliabilityWindowLabel;
    startAt: string;
    endAt: string;
    total: number;
    succeeded: number;
    failed: number;
    timedOut: number;
    unknown: number;
    successRate: number | null;
    failureRate: number | null;
    timeoutRate: number | null;
    lastSignalAt: string | null;
    state: ReliabilityWindowState;
  }>;
};

type ReliabilityOperationalEventRow = {
  id: string;
  source: string;
  event_type: string;
  system: string;
  environment: string | null;
  event_ts: Date;
  metadata_json: unknown;
};

type FindManyArgs = Record<string, unknown>;

export type ReliabilityWindowsClient = {
  operationalEvent: {
    findMany: (args: FindManyArgs) => Promise<ReliabilityOperationalEventRow[]>;
  };
};

type NormalizedStatus = "succeeded" | "failed" | "timedOut" | "unknown";

const WINDOW_DEFINITIONS: Array<{ label: ReliabilityWindowLabel; hours: number }> = [
  { label: "1h", hours: 1 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 24 * 7 }
];

const FAILING_ERROR_RATE_THRESHOLD = 0.2;
const FAILING_ERROR_COUNT_THRESHOLD = 10;

function subtractHours(from: Date, hours: number) {
  return new Date(from.getTime() - hours * 60 * 60_000);
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function lower(value: string | null) {
  return value?.toLowerCase() ?? "";
}

function normalizeStatus(event: ReliabilityOperationalEventRow): NormalizedStatus {
  const metadata = asObject(event.metadata_json);
  const status = lower(stringField(metadata, "status", "conclusion", "outcome", "state"));
  const eventType = event.event_type.toLowerCase();

  if (
    status === "timed_out" ||
    status === "timeout" ||
    eventType.includes("timed_out") ||
    eventType.includes("timeout")
  ) {
    return "timedOut";
  }

  if (
    status === "failed" ||
    status === "failure" ||
    status === "error" ||
    eventType.endsWith("_failed") ||
    eventType.endsWith("_failure") ||
    eventType.endsWith("_error")
  ) {
    return "failed";
  }

  if (
    status === "success" ||
    status === "succeeded" ||
    status === "completed" ||
    eventType.endsWith("_success") ||
    eventType.endsWith("_succeeded") ||
    eventType.endsWith("_completed")
  ) {
    return "succeeded";
  }

  return "unknown";
}

function matchesAnyField(
  record: Record<string, unknown>,
  expected: string | null | undefined,
  ...keys: string[]
) {
  if (!expected) {
    return true;
  }
  return keys.some((key) => stringField(record, key) === expected);
}

function matchesScope(
  event: ReliabilityOperationalEventRow,
  input: {
    workflowId?: string | null;
    sourceId?: string | null;
    sourceKey?: string | null;
  }
) {
  const metadata = asObject(event.metadata_json);

  return (
    matchesAnyField(metadata, input.workflowId, "workflow_id", "workflowId", "source_id", "sourceId") &&
    matchesAnyField(metadata, input.sourceId, "source_id", "sourceId") &&
    matchesAnyField(metadata, input.sourceKey, "source_key", "sourceKey")
  );
}

function rate(count: number, total: number) {
  if (total === 0) {
    return null;
  }
  return Math.round((count / total) * 10_000) / 10_000;
}

function reliabilityState(input: { total: number; failed: number; timedOut: number }) {
  if (input.total === 0) {
    return "unknown" as const;
  }

  const errorCount = input.failed + input.timedOut;
  if (errorCount === 0) {
    return "healthy" as const;
  }

  const errorRate = errorCount / input.total;
  if (errorRate >= FAILING_ERROR_RATE_THRESHOLD || errorCount >= FAILING_ERROR_COUNT_THRESHOLD) {
    return "failing" as const;
  }

  return "degraded" as const;
}

function isoOrNull(value: Date | null) {
  return value ? value.toISOString() : null;
}

function countWindow(input: {
  label: ReliabilityWindowLabel;
  startAt: Date;
  endAt: Date;
  events: ReliabilityOperationalEventRow[];
}) {
  const counts = {
    succeeded: 0,
    failed: 0,
    timedOut: 0,
    unknown: 0
  };
  let lastSignalAt: Date | null = null;

  for (const event of input.events) {
    if (event.event_ts.getTime() < input.startAt.getTime() || event.event_ts.getTime() > input.endAt.getTime()) {
      continue;
    }

    if (!lastSignalAt || event.event_ts.getTime() > lastSignalAt.getTime()) {
      lastSignalAt = event.event_ts;
    }

    const status = normalizeStatus(event);
    counts[status] += 1;
  }

  const total = counts.succeeded + counts.failed + counts.timedOut + counts.unknown;

  return {
    label: input.label,
    startAt: input.startAt.toISOString(),
    endAt: input.endAt.toISOString(),
    total,
    ...counts,
    successRate: rate(counts.succeeded, total),
    failureRate: rate(counts.failed, total),
    timeoutRate: rate(counts.timedOut, total),
    lastSignalAt: isoOrNull(lastSignalAt),
    state: reliabilityState({
      total,
      failed: counts.failed,
      timedOut: counts.timedOut
    })
  };
}

export async function getReliabilityWindows(input: {
  tenantId: string;
  workflowId?: string | null;
  sourceId?: string | null;
  sourceKey?: string | null;
  now?: Date;
  client?: ReliabilityWindowsClient;
}): Promise<ReliabilityWindows> {
  const now = input.now ?? new Date();
  const client = input.client ?? (prisma as unknown as ReliabilityWindowsClient);
  const oldestWindowStart = subtractHours(now, WINDOW_DEFINITIONS[WINDOW_DEFINITIONS.length - 1].hours);

  const rows = await client.operationalEvent.findMany({
    where: {
      tenant_id: input.tenantId,
      event_ts: {
        gte: oldestWindowStart,
        lte: now
      }
    },
    select: {
      id: true,
      source: true,
      event_type: true,
      system: true,
      environment: true,
      event_ts: true,
      metadata_json: true
    },
    orderBy: [
      {
        event_ts: "desc"
      },
      {
        id: "desc"
      }
    ]
  });

  const scopedEvents = rows.filter((event) =>
    matchesScope(event, {
      workflowId: input.workflowId ?? null,
      sourceId: input.sourceId ?? null,
      sourceKey: input.sourceKey ?? null
    })
  );

  return {
    generatedAt: now.toISOString(),
    scope: {
      tenantId: input.tenantId,
      workflowId: input.workflowId ?? null,
      sourceId: input.sourceId ?? null,
      sourceKey: input.sourceKey ?? null
    },
    windows: WINDOW_DEFINITIONS.map((definition) =>
      countWindow({
        label: definition.label,
        startAt: subtractHours(now, definition.hours),
        endAt: now,
        events: scopedEvents
      })
    )
  };
}
