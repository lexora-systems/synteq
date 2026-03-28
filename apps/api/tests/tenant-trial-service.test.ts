import { describe, expect, it } from "vitest";
import {
  getTenantEntitlements,
  resolveTenantEntitlementsFromRow,
  startTrialIfEligible
} from "../src/services/tenant-trial-service.js";

type TenantTrialRow = {
  id: string;
  plan: string;
  trial_status: string;
  trial_started_at: Date | null;
  trial_ends_at: Date | null;
  trial_source: string | null;
};

function makeClient(initial: TenantTrialRow) {
  let row: TenantTrialRow = { ...initial };

  return {
    getRow: () => ({ ...row }),
    client: {
      tenant: {
        findUnique: async (_args: any) => ({ ...row }),
        updateMany: async (args: any) => {
          const expectedId = args.where?.id;
          if (expectedId !== row.id) {
            return { count: 0 };
          }

          if (Object.prototype.hasOwnProperty.call(args.where, "trial_started_at") && row.trial_started_at !== null) {
            return { count: 0 };
          }

          const blockedPlans: string[] =
            (args.where?.NOT as Array<{ plan?: { in?: string[] } }> | undefined)?.flatMap(
              (entry) => entry.plan?.in ?? []
            ) ?? [];
          if (blockedPlans.includes(row.plan)) {
            return { count: 0 };
          }

          row = {
            ...row,
            ...(args.data ?? {})
          };
          return { count: 1 };
        },
        update: async (args: any) => {
          row = {
            ...row,
            ...(args.data ?? {})
          };
          return { ...row };
        }
      }
    }
  };
}

describe("tenant trial service", () => {
  it("starts a 14-day trial manually when eligible", async () => {
    const now = new Date("2026-03-19T10:00:00.000Z");
    const { client } = makeClient({
      id: "tenant-A",
      plan: "free",
      trial_status: "none",
      trial_started_at: null,
      trial_ends_at: null,
      trial_source: null
    });

    const result = await startTrialIfEligible({
      tenantId: "tenant-A",
      source: "manual",
      now,
      client: client as any
    });

    expect(result.code).toBe("started");
    expect(result.entitlements.effective_plan).toBe("pro");
    expect(result.entitlements.trial.active).toBe(true);
    expect(result.entitlements.trial.source).toBe("manual");
    expect(result.entitlements.trial.days_remaining).toBe(14);
  });

  it("starts only once and returns already_active while trial is active", async () => {
    const now = new Date("2026-03-19T10:00:00.000Z");
    const { client } = makeClient({
      id: "tenant-A",
      plan: "free",
      trial_status: "none",
      trial_started_at: null,
      trial_ends_at: null,
      trial_source: null
    });

    const first = await startTrialIfEligible({
      tenantId: "tenant-A",
      source: "auto_ingest",
      now,
      client: client as any
    });
    const second = await startTrialIfEligible({
      tenantId: "tenant-A",
      source: "manual",
      now: new Date("2026-03-20T10:00:00.000Z"),
      client: client as any
    });

    expect(first.code).toBe("started");
    expect(second.code).toBe("already_active");
  });

  it("marks expired trial tenants as free effective plan", () => {
    const entitlements = resolveTenantEntitlementsFromRow(
      {
        id: "tenant-A",
        plan: "free",
        trial_status: "active",
        trial_started_at: new Date("2026-03-01T00:00:00.000Z"),
        trial_ends_at: new Date("2026-03-15T00:00:00.000Z"),
        trial_source: "manual"
      },
      new Date("2026-03-19T00:00:00.000Z")
    );

    expect(entitlements.trial.status).toBe("expired");
    expect(entitlements.effective_plan).toBe("free");
    expect(entitlements.trial.consumed).toBe(true);
  });

  it("does not allow a second trial after expiry", async () => {
    const now = new Date("2026-03-19T10:00:00.000Z");
    const { client } = makeClient({
      id: "tenant-A",
      plan: "free",
      trial_status: "expired",
      trial_started_at: new Date("2026-03-01T00:00:00.000Z"),
      trial_ends_at: new Date("2026-03-15T00:00:00.000Z"),
      trial_source: "manual"
    });

    const result = await startTrialIfEligible({
      tenantId: "tenant-A",
      source: "manual",
      now,
      client: client as any
    });

    expect(result.code).toBe("already_used");
  });

  it("returns not_eligible for paid plans", async () => {
    const { client } = makeClient({
      id: "tenant-A",
      plan: "pro",
      trial_status: "none",
      trial_started_at: null,
      trial_ends_at: null,
      trial_source: null
    });

    const result = await startTrialIfEligible({
      tenantId: "tenant-A",
      source: "manual",
      client: client as any
    });

    expect(result.code).toBe("not_eligible");
    expect(result.entitlements.current_plan).toBe("pro");
  });

  it("syncs stale stored status during entitlement reads", async () => {
    const { client, getRow } = makeClient({
      id: "tenant-A",
      plan: "free",
      trial_status: "active",
      trial_started_at: new Date("2026-03-01T00:00:00.000Z"),
      trial_ends_at: new Date("2026-03-10T00:00:00.000Z"),
      trial_source: "manual"
    });

    const entitlements = await getTenantEntitlements({
      tenantId: "tenant-A",
      now: new Date("2026-03-19T00:00:00.000Z"),
      client: client as any
    });

    expect(entitlements.trial.status).toBe("expired");
    expect(getRow().trial_status).toBe("expired");
  });
});
