import { describe, expect, it } from "vitest";
import { resolveTenantEntitlementsFromRow } from "../src/services/tenant-trial-service.js";
import {
  EntitlementError,
  requireFeature,
  requirePlanAtLeast,
  requireSourceCapacity,
  resolveTenantAccessFromEntitlements
} from "../src/services/entitlement-guard-service.js";

describe("entitlement guard service", () => {
  it("treats active trial tenants as pro-equivalent access", () => {
    const entitlements = resolveTenantEntitlementsFromRow(
      {
        id: "tenant-trial",
        plan: "free",
        trial_status: "active",
        trial_started_at: new Date("2026-03-10T00:00:00.000Z"),
        trial_ends_at: new Date("2026-03-24T00:00:00.000Z"),
        trial_source: "manual"
      },
      new Date("2026-03-20T00:00:00.000Z")
    );
    const access = resolveTenantAccessFromEntitlements(entitlements);

    expect(() => requirePlanAtLeast(access, "pro")).not.toThrow();
    expect(() => requireFeature(access, "alerts")).not.toThrow();
    expect(access.detectionLevel).toBe("full");
    expect(access.alertMode).toBe("full");
    expect(access.incidentMode).toBe("full");
    expect(access.simulationAllowed).toBe(true);
    expect(() =>
      requireSourceCapacity({
        access,
        currentActiveSources: 10
      })
    ).not.toThrow();
  });

  it("falls back expired trial tenants to free restrictions", () => {
    const entitlements = resolveTenantEntitlementsFromRow(
      {
        id: "tenant-expired",
        plan: "free",
        trial_status: "active",
        trial_started_at: new Date("2026-03-01T00:00:00.000Z"),
        trial_ends_at: new Date("2026-03-15T00:00:00.000Z"),
        trial_source: "manual"
      },
      new Date("2026-03-20T00:00:00.000Z")
    );
    const access = resolveTenantAccessFromEntitlements(entitlements);

    expect(() => requireFeature(access, "alerts")).toThrow(EntitlementError);
    expect(access.detectionLevel).toBe("basic");
    expect(access.alertMode).toBe("basic_email");
    expect(access.incidentMode).toBe("basic");
    expect(access.features.team_members).toBe(false);
    expect(access.maxSources).toBe(1);
    expect(access.maxHistoryHours).toBe(24);
    expect(() =>
      requireSourceCapacity({
        access,
        currentActiveSources: 1
      })
    ).toThrow(EntitlementError);
  });

  it("maps paid plans to full entitlement modes", () => {
    const entitlements = resolveTenantEntitlementsFromRow(
      {
        id: "tenant-pro",
        plan: "pro",
        trial_status: "none",
        trial_started_at: null,
        trial_ends_at: null,
        trial_source: null
      },
      new Date("2026-03-20T00:00:00.000Z")
    );
    const access = resolveTenantAccessFromEntitlements(entitlements);

    expect(access.detectionLevel).toBe("full");
    expect(access.alertMode).toBe("full");
    expect(access.incidentMode).toBe("full");
    expect(access.maxSources).toBeNull();
    expect(access.maxHistoryHours).toBeNull();
    expect(access.features.team_members).toBe(true);
  });
});
