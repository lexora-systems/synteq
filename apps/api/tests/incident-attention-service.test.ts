import { describe, expect, it } from "vitest";
import {
  getIncidentAttentionGroups,
  type IncidentAttentionClient
} from "../src/services/incident-attention-service.js";

type IncidentRow = {
  id: string;
  tenant_id: string;
  policy_id: string | null;
  workflow_id: string | null;
  environment: string | null;
  status: "open" | "acked" | "resolved";
  severity: string;
  started_at: Date;
  last_seen_at: Date;
  sla_due_at: Date | null;
  sla_breached_at: Date | null;
  fingerprint: string | null;
  details_json: Record<string, unknown>;
  workflow?: {
    id: string;
    display_name: string;
    slug: string;
    system: string;
    environment: string;
  } | null;
  policy?: {
    id: string;
    metric: string;
    name: string;
  } | null;
};

type IncidentEventRow = {
  id: number;
  incident_id: string;
  event_type: string;
  at_time: Date;
};

type FindingLinkRow = {
  id: number;
  tenant_id: string;
  incident_id: string;
  finding?: {
    source: string;
    rule_key: string;
    system: string;
    fingerprint: string;
  } | null;
};

const now = new Date("2026-05-01T10:00:00.000Z");

function minutesAgo(minutes: number) {
  return new Date(now.getTime() - minutes * 60_000);
}

function incident(overrides: Partial<IncidentRow> = {}): IncidentRow {
  return {
    id: "inc-1",
    tenant_id: "tenant-A",
    policy_id: null,
    workflow_id: null,
    environment: "production",
    status: "open",
    severity: "low",
    started_at: minutesAgo(120),
    last_seen_at: minutesAgo(5),
    sla_due_at: minutesAgo(-60),
    sla_breached_at: null,
    fingerprint: "fp-1",
    details_json: {},
    workflow: null,
    policy: null,
    ...overrides
  };
}

function event(overrides: Partial<IncidentEventRow>): IncidentEventRow {
  return {
    id: 1,
    incident_id: "inc-1",
    event_type: "ALERT_FAILED",
    at_time: minutesAgo(10),
    ...overrides
  };
}

function findingLink(overrides: Partial<FindingLinkRow>): FindingLinkRow {
  return {
    id: 1,
    tenant_id: "tenant-A",
    incident_id: "inc-1",
    finding: {
      source: "github_actions",
      rule_key: "github.workflow_failed",
      system: "acme/payments",
      fingerprint: "finding-fp"
    },
    ...overrides
  };
}

function matchesStatus(status: string, filter: unknown) {
  if (!filter || typeof filter !== "object" || !("in" in filter)) {
    return true;
  }
  const values = (filter as { in?: unknown[] }).in;
  return Array.isArray(values) ? values.includes(status) : true;
}

function createClient(state: {
  incidents?: IncidentRow[];
  events?: IncidentEventRow[];
  findingLinks?: FindingLinkRow[];
  seenIncidentWhere?: unknown[];
}): IncidentAttentionClient {
  const incidents = state.incidents ?? [];
  const events = state.events ?? [];
  const findingLinks = state.findingLinks ?? [];

  return {
    incident: {
      findMany: async (args) => {
        state.seenIncidentWhere?.push(args.where);
        const where = args.where as { tenant_id?: string; status?: unknown };
        return incidents
          .filter((row) => row.tenant_id === where.tenant_id && matchesStatus(row.status, where.status))
          .sort((left, right) => right.last_seen_at.getTime() - left.last_seen_at.getTime())
          .map(
            ({
              id,
              policy_id,
              workflow_id,
              environment,
              status,
              severity,
              started_at,
              last_seen_at,
              sla_due_at,
              sla_breached_at,
              fingerprint,
              details_json,
              workflow,
              policy
            }) => ({
              id,
              policy_id,
              workflow_id,
              environment,
              status,
              severity,
              started_at,
              last_seen_at,
              sla_due_at,
              sla_breached_at,
              fingerprint,
              details_json,
              workflow,
              policy
            })
          );
      }
    },
    incidentEvent: {
      findMany: async (args) => {
        const where = args.where as { incident_id?: { in?: string[] }; event_type?: { in?: string[] } };
        const incidentIds = where.incident_id?.in ?? [];
        const eventTypes = where.event_type?.in ?? [];
        return events
          .filter((row) => incidentIds.includes(row.incident_id) && eventTypes.includes(row.event_type))
          .sort((left, right) => right.at_time.getTime() - left.at_time.getTime())
          .map(({ id, incident_id, event_type, at_time }) => ({
            id,
            incident_id,
            event_type,
            at_time
          }));
      }
    },
    findingIncidentLink: {
      findMany: async (args) => {
        const where = args.where as { tenant_id?: string; incident_id?: { in?: string[] } };
        const incidentIds = where.incident_id?.in ?? [];
        return findingLinks
          .filter((row) => row.tenant_id === where.tenant_id && incidentIds.includes(row.incident_id))
          .map(({ id, tenant_id, incident_id, finding }) => ({
            id,
            tenant_id,
            incident_id,
            finding
          }));
      }
    }
  };
}

async function readGroups(state: {
  incidents?: IncidentRow[];
  events?: IncidentEventRow[];
  findingLinks?: FindingLinkRow[];
  seenIncidentWhere?: unknown[];
}) {
  return getIncidentAttentionGroups({
    tenantId: "tenant-A",
    now,
    client: createClient(state)
  });
}

describe("incident attention service", () => {
  it("keeps reads scoped to the requested tenant and only includes open or acked incidents", async () => {
    const seenIncidentWhere: unknown[] = [];
    const result = await readGroups({
      seenIncidentWhere,
      incidents: [
        incident({ id: "inc-open", fingerprint: "fp-open", status: "open" }),
        incident({ id: "inc-acked", fingerprint: "fp-acked", status: "acked" }),
        incident({ id: "inc-resolved", fingerprint: "fp-resolved", status: "resolved" }),
        incident({ id: "inc-other", tenant_id: "tenant-B", severity: "critical" })
      ]
    });

    expect(seenIncidentWhere[0]).toMatchObject({
      tenant_id: "tenant-A",
      status: {
        in: ["open", "acked"]
      }
    });
    expect(result.groups).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain("inc-resolved");
    expect(JSON.stringify(result)).not.toContain("inc-other");
  });

  it("groups duplicate active incident fingerprints before broader context", async () => {
    const result = await readGroups({
      incidents: [
        incident({ id: "inc-1", fingerprint: "fp-repeat", status: "open" }),
        incident({ id: "inc-2", fingerprint: "fp-repeat", status: "acked" }),
        incident({ id: "inc-3", fingerprint: "fp-single" })
      ]
    });

    const fingerprintGroup = result.groups.find((group) => group.groupKey.fingerprint === "fp-repeat");
    expect(fingerprintGroup).toMatchObject({
      incidentCount: 2,
      activeStatuses: {
        open: 1,
        acked: 1
      }
    });
  });

  it("groups single-fingerprint incidents by workflow and environment", async () => {
    const result = await readGroups({
      incidents: [
        incident({
          id: "inc-1",
          fingerprint: "fp-1",
          workflow_id: "wf-1",
          workflow: {
            id: "wf-1",
            display_name: "Customer Onboarding",
            slug: "customer-onboarding",
            system: "n8n:customer-onboarding",
            environment: "production"
          }
        }),
        incident({
          id: "inc-2",
          fingerprint: "fp-2",
          workflow_id: "wf-1",
          workflow: {
            id: "wf-1",
            display_name: "Customer Onboarding",
            slug: "customer-onboarding",
            system: "n8n:customer-onboarding",
            environment: "production"
          }
        })
      ]
    });

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({
      label: "Customer Onboarding / production",
      incidentCount: 2,
      groupKey: {
        workflowId: "wf-1",
        workflowName: "Customer Onboarding",
        environment: "production"
      },
      attention: "elevated"
    });
  });

  it("groups finding-backed incidents by source, system, and rule key", async () => {
    const result = await readGroups({
      incidents: [
        incident({ id: "inc-1", fingerprint: "fp-1", workflow_id: null, environment: null }),
        incident({ id: "inc-2", fingerprint: "fp-2", workflow_id: null, environment: null })
      ],
      findingLinks: [
        findingLink({ incident_id: "inc-1" }),
        findingLink({ id: 2, incident_id: "inc-2" })
      ]
    });

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({
      label: "acme/payments / github workflow failed",
      incidentCount: 2,
      groupKey: {
        source: "github_actions",
        system: "acme/payments",
        ruleKey: "github.workflow_failed"
      }
    });
  });

  it("falls back to a single incident group when stable context is missing", async () => {
    const result = await readGroups({
      incidents: [
        incident({
          id: "inc-minimal",
          fingerprint: null,
          workflow_id: null,
          environment: null,
          details_json: {}
        })
      ]
    });

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({
      label: "Incident inc-minimal",
      incidentCount: 1,
      groupKey: {}
    });
  });

  it("derives urgent attention for critical incidents, breached SLAs, and high severity with recent alert failures", async () => {
    const critical = await readGroups({
      incidents: [incident({ severity: "critical" })]
    });
    const breached = await readGroups({
      incidents: [incident({ id: "inc-breach", fingerprint: "fp-breach", sla_breached_at: minutesAgo(1) })]
    });
    const highWithFailure = await readGroups({
      incidents: [incident({ id: "inc-high", fingerprint: "fp-high", severity: "high" })],
      events: [event({ incident_id: "inc-high", event_type: "ALERT_FAILED", at_time: minutesAgo(5) })]
    });

    expect(critical.groups[0].attention).toBe("urgent");
    expect(breached.groups[0].attention).toBe("urgent");
    expect(highWithFailure.groups[0]).toMatchObject({
      attention: "urgent",
      alertFailureCount: 1
    });
  });

  it("derives elevated, normal, and unknown attention deterministically", async () => {
    const elevated = await readGroups({
      incidents: [incident({ severity: "medium" })]
    });
    const repeated = await readGroups({
      incidents: [incident({ id: "inc-repeat", fingerprint: "fp-repeat", severity: "low" })],
      events: [
        event({ id: 1, incident_id: "inc-repeat", event_type: "DETECTED" }),
        event({ id: 2, incident_id: "inc-repeat", event_type: "BRIDGE_REFRESHED" })
      ]
    });
    const normal = await readGroups({
      incidents: [incident({ severity: "low" })]
    });
    const unknown = await readGroups({
      incidents: [incident({ severity: "mystery", fingerprint: null, environment: null })]
    });

    expect(elevated.groups[0].attention).toBe("elevated");
    expect(repeated.groups[0].attention).toBe("elevated");
    expect(normal.groups[0].attention).toBe("normal");
    expect(unknown.groups[0]).toMatchObject({
      highestSeverity: "unknown",
      attention: "unknown"
    });
  });

  it("counts alert failures without returning sensitive details", async () => {
    const result = await readGroups({
      incidents: [
        incident({
          id: "inc-secret",
          fingerprint: null,
          details_json: {
            source: "webhook",
            webhook_secret: "do-not-return",
            api_key: "also-hidden"
          }
        })
      ],
      events: [
        event({ id: 1, incident_id: "inc-secret", event_type: "ALERT_FAILED" }),
        event({ id: 2, incident_id: "inc-secret", event_type: "ALERT_SKIPPED" }),
        event({ id: 3, incident_id: "inc-secret", event_type: "ALERT_SENT" })
      ]
    });

    expect(result.groups[0]).toMatchObject({
      alertFailureCount: 2,
      attention: "elevated"
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("do-not-return");
    expect(serialized).not.toContain("also-hidden");
    expect(serialized).not.toContain("api_key");
    expect(serialized).not.toContain("webhook_secret");
  });
});
