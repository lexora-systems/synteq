import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasRequiredRole } from "../src/utils/rbac.js";
import { Permission, hasRequiredPermissions } from "../src/auth/permissions.js";

const countMock = vi.fn();
const findManyMock = vi.fn();

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    incident: {
      count: countMock,
      findMany: findManyMock
    },
    incidentEvent: {
      createMany: vi.fn(),
      create: vi.fn()
    }
  }
}));

describe("rbac and tenant isolation", () => {
  beforeEach(() => {
    countMock.mockReset();
    findManyMock.mockReset();
  });

  it("checks role permissions", () => {
    expect(hasRequiredRole("owner", ["owner", "admin"])).toBe(true);
    expect(hasRequiredRole("viewer", ["owner", "admin", "engineer"])).toBe(false);
    expect(hasRequiredPermissions("viewer", [Permission.DASHBOARD_VIEW])).toBe(true);
    expect(hasRequiredPermissions("viewer", [Permission.INCIDENTS_WRITE])).toBe(false);
    expect(hasRequiredPermissions("engineer", [Permission.WORKFLOWS_WRITE, Permission.INCIDENTS_WRITE])).toBe(true);
  });

  it("enforces tenant filter in incident list queries", async () => {
    countMock.mockResolvedValue(1);
    findManyMock.mockResolvedValue([]);
    const { listIncidents } = await import("../src/services/incidents-service.js");

    await listIncidents({
      tenantId: "tenant-A",
      status: "open",
      page: 1,
      pageSize: 25
    });

    expect(countMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenant_id: "tenant-A"
        })
      })
    );
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenant_id: "tenant-A"
        })
      })
    );
  });
});
