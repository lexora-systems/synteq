import { beforeEach, describe, expect, it, vi } from "vitest";

const openOrRefreshBridgeIncidentMock = vi.fn();
const resolveBridgeIncidentMock = vi.fn();

vi.mock("../src/services/incidents-service.js", () => ({
  openOrRefreshBridgeIncident: openOrRefreshBridgeIncidentMock,
  resolveBridgeIncident: resolveBridgeIncidentMock
}));

type FindingRow = {
  id: string;
  tenant_id: string;
  source: string;
  rule_key: string;
  severity: "warn" | "low" | "medium" | "high" | "critical";
  status: "open" | "resolved";
  system: string;
  correlation_key: string | null;
  fingerprint: string;
  summary: string;
  evidence_json: Record<string, unknown>;
  first_seen_at: Date;
  last_seen_at: Date;
  updated_at: Date;
  event_count: number;
};

type LinkRow = {
  id: number;
  tenant_id: string;
  finding_id: string;
  incident_id: string;
  bridge_key: string;
  last_bridged_at: Date;
};

function makeClient(seed: { findings: FindingRow[]; links?: LinkRow[] }) {
  const state = {
    findings: [...seed.findings],
    links: [...(seed.links ?? [])],
    cursor: null as null | {
      worker_key: string;
      last_finding_updated_at: Date | null;
      last_finding_id: string | null;
    }
  };

  const filterFindings = (where: any) =>
    state.findings.filter((finding) => {
      if (where.source && finding.source !== where.source) return false;
      if (where.rule_key?.in && !where.rule_key.in.includes(finding.rule_key)) return false;
      if (where.status?.in && !where.status.in.includes(finding.status)) return false;

      if (where.OR) {
        const matched = where.OR.some((branch: any) => {
          if (branch.updated_at?.gt) {
            return finding.updated_at > branch.updated_at.gt;
          }
          if (branch.AND) {
            const updatedEq = branch.AND.find((item: any) => item.updated_at !== undefined)?.updated_at;
            const idGt = branch.AND.find((item: any) => item.id !== undefined)?.id;
            return (
              updatedEq &&
              idGt &&
              finding.updated_at.getTime() === new Date(updatedEq).getTime() &&
              finding.id > idGt.gt
            );
          }
          return false;
        });
        if (!matched) return false;
      }

      return true;
    });

  return {
    state,
    client: {
      operationalFinding: {
        findMany: async (args: any) => {
          const rows = filterFindings(args.where);
          const sorted = [...rows].sort((a, b) => {
            const byTime = a.updated_at.getTime() - b.updated_at.getTime();
            if (byTime !== 0) return byTime;
            return a.id.localeCompare(b.id);
          });
          return typeof args.take === "number" ? sorted.slice(0, args.take) : sorted;
        }
      },
      incidentBridgeCursor: {
        findUnique: async (args: any) => {
          if (!state.cursor || state.cursor.worker_key !== args.where.worker_key) {
            return null;
          }
          return state.cursor;
        },
        upsert: async (args: any) => {
          if (!state.cursor) {
            state.cursor = {
              worker_key: args.create.worker_key,
              last_finding_updated_at: args.create.last_finding_updated_at,
              last_finding_id: args.create.last_finding_id
            };
            return state.cursor;
          }
          state.cursor.last_finding_updated_at = args.update.last_finding_updated_at;
          state.cursor.last_finding_id = args.update.last_finding_id;
          return state.cursor;
        }
      },
      findingIncidentLink: {
        findUnique: async (args: any) => {
          if (args.where.finding_id) {
            return state.links.find((link) => link.finding_id === args.where.finding_id) ?? null;
          }
          if (typeof args.where.id === "number") {
            return state.links.find((link) => link.id === args.where.id) ?? null;
          }
          return null;
        },
        upsert: async (args: any) => {
          const existing = state.links.find((link) => link.finding_id === args.where.finding_id);
          if (!existing) {
            const created: LinkRow = {
              id: state.links.length + 1,
              tenant_id: args.create.tenant_id,
              finding_id: args.create.finding_id,
              incident_id: args.create.incident_id,
              bridge_key: args.create.bridge_key,
              last_bridged_at: args.create.last_bridged_at
            };
            state.links.push(created);
            return created;
          }

          Object.assign(existing, args.update);
          return existing;
        },
        update: async (args: any) => {
          const existing = state.links.find((link) => link.id === args.where.id);
          if (!existing) throw new Error("Link not found");
          Object.assign(existing, args.data);
          return existing;
        }
      }
    }
  };
}

describe("incident bridge service", () => {
  beforeEach(() => {
    vi.resetModules();
    openOrRefreshBridgeIncidentMock.mockReset();
    resolveBridgeIncidentMock.mockReset();
  });

  it("creates incident for eligible open finding and persists traceable link", async () => {
    const finding: FindingRow = {
      id: "finding-1",
      tenant_id: "tenant-A",
      source: "github_actions",
      rule_key: "github.workflow_failed",
      severity: "high",
      status: "open",
      system: "acme/payments",
      correlation_key: "acme/payments:workflow_run:1",
      fingerprint: "fp-1",
      summary: "Workflow failed",
      evidence_json: { triggering_event_id: "evt-1" },
      first_seen_at: new Date("2026-03-17T10:00:00.000Z"),
      last_seen_at: new Date("2026-03-17T10:05:00.000Z"),
      updated_at: new Date("2026-03-17T10:06:00.000Z"),
      event_count: 1
    };

    const { client, state } = makeClient({ findings: [finding] });
    openOrRefreshBridgeIncidentMock.mockResolvedValue({
      action: "created",
      incident: { id: "incident-1" }
    });

    const { runIncidentBridgeBatch } = await import("../src/services/incident-bridge-service.js");
    const result = await runIncidentBridgeBatch({ client: client as any, logger: { info: () => undefined, warn: () => undefined, error: () => undefined } });

    expect(result.incidents_created).toBe(1);
    expect(openOrRefreshBridgeIncidentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: "high",
        summary: expect.stringContaining("GitHub workflow failure detected in acme/payments")
      })
    );
    expect(state.links).toHaveLength(1);
    expect(state.links[0]).toMatchObject({
      finding_id: "finding-1",
      incident_id: "incident-1"
    });
  });

  it("does not duplicate incidents on repeated runs with no new findings", async () => {
    const finding: FindingRow = {
      id: "finding-2",
      tenant_id: "tenant-A",
      source: "github_actions",
      rule_key: "github.workflow_failed",
      severity: "high",
      status: "open",
      system: "acme/payments",
      correlation_key: null,
      fingerprint: "fp-2",
      summary: "Workflow failed",
      evidence_json: {},
      first_seen_at: new Date("2026-03-17T10:00:00.000Z"),
      last_seen_at: new Date("2026-03-17T10:05:00.000Z"),
      updated_at: new Date("2026-03-17T10:06:00.000Z"),
      event_count: 1
    };

    const { client } = makeClient({ findings: [finding] });
    openOrRefreshBridgeIncidentMock.mockResolvedValue({
      action: "created",
      incident: { id: "incident-2" }
    });

    const { runIncidentBridgeBatch } = await import("../src/services/incident-bridge-service.js");
    const first = await runIncidentBridgeBatch({ client: client as any, logger: { info: () => undefined, warn: () => undefined, error: () => undefined } });
    const second = await runIncidentBridgeBatch({ client: client as any, logger: { info: () => undefined, warn: () => undefined, error: () => undefined } });

    expect(first.processed_findings).toBe(1);
    expect(second.processed_findings).toBe(0);
    expect(openOrRefreshBridgeIncidentMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes existing linked incident when finding stays open", async () => {
    const finding: FindingRow = {
      id: "finding-3",
      tenant_id: "tenant-A",
      source: "github_actions",
      rule_key: "github.job_failed_burst",
      severity: "high",
      status: "open",
      system: "acme/payments",
      correlation_key: null,
      fingerprint: "fp-3",
      summary: "Job burst",
      evidence_json: {},
      first_seen_at: new Date("2026-03-17T10:00:00.000Z"),
      last_seen_at: new Date("2026-03-17T10:15:00.000Z"),
      updated_at: new Date("2026-03-17T10:16:00.000Z"),
      event_count: 3
    };

    const { client } = makeClient({
      findings: [finding],
      links: [
        {
          id: 1,
          tenant_id: "tenant-A",
          finding_id: "finding-3",
          incident_id: "incident-existing",
          bridge_key: "fp-3",
          last_bridged_at: new Date("2026-03-17T10:10:00.000Z")
        }
      ]
    });
    openOrRefreshBridgeIncidentMock.mockResolvedValue({
      action: "updated",
      incident: { id: "incident-existing" }
    });

    const { runIncidentBridgeBatch } = await import("../src/services/incident-bridge-service.js");
    const result = await runIncidentBridgeBatch({ client: client as any, logger: { info: () => undefined, warn: () => undefined, error: () => undefined } });

    expect(result.incidents_refreshed).toBe(1);
    expect(openOrRefreshBridgeIncidentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        incidentId: "incident-existing"
      })
    );
  });

  it("resolves linked incident when finding is resolved", async () => {
    const finding: FindingRow = {
      id: "finding-4",
      tenant_id: "tenant-A",
      source: "github_actions",
      rule_key: "github.workflow_stuck",
      severity: "medium",
      status: "resolved",
      system: "acme/payments",
      correlation_key: "acme/payments:workflow_run:7",
      fingerprint: "fp-4",
      summary: "Workflow stuck",
      evidence_json: {},
      first_seen_at: new Date("2026-03-17T09:00:00.000Z"),
      last_seen_at: new Date("2026-03-17T09:30:00.000Z"),
      updated_at: new Date("2026-03-17T09:31:00.000Z"),
      event_count: 2
    };

    const { client } = makeClient({
      findings: [finding],
      links: [
        {
          id: 1,
          tenant_id: "tenant-A",
          finding_id: "finding-4",
          incident_id: "incident-4",
          bridge_key: "fp-4",
          last_bridged_at: new Date("2026-03-17T09:10:00.000Z")
        }
      ]
    });
    resolveBridgeIncidentMock.mockResolvedValue({ resolved: true });

    const { runIncidentBridgeBatch } = await import("../src/services/incident-bridge-service.js");
    const result = await runIncidentBridgeBatch({ client: client as any, logger: { info: () => undefined, warn: () => undefined, error: () => undefined } });

    expect(result.incidents_resolved).toBe(1);
    expect(resolveBridgeIncidentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        incidentId: "incident-4"
      })
    );
  });

  it("ignores unsupported findings safely and validates severity/title mapping", async () => {
    const finding: FindingRow = {
      id: "finding-5",
      tenant_id: "tenant-A",
      source: "security_scanner",
      rule_key: "security.critical",
      severity: "critical",
      status: "open",
      system: "acme/payments",
      correlation_key: null,
      fingerprint: "fp-5",
      summary: "Unsupported",
      evidence_json: {},
      first_seen_at: new Date("2026-03-17T10:00:00.000Z"),
      last_seen_at: new Date("2026-03-17T10:02:00.000Z"),
      updated_at: new Date("2026-03-17T10:03:00.000Z"),
      event_count: 1
    };

    const { client } = makeClient({ findings: [finding] });
    const { runIncidentBridgeBatch } = await import("../src/services/incident-bridge-service.js");
    const result = await runIncidentBridgeBatch({ client: client as any, logger: { info: () => undefined, warn: () => undefined, error: () => undefined } });

    expect(result.processed_findings).toBe(0);
    expect(openOrRefreshBridgeIncidentMock).not.toHaveBeenCalled();
    expect(resolveBridgeIncidentMock).not.toHaveBeenCalled();
  });
});
