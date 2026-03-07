import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getTenantSettingsMock = vi.fn();
const updateTenantSettingsMock = vi.fn();

vi.mock("../src/services/settings-service.js", () => ({
  getTenantSettings: getTenantSettingsMock,
  updateTenantSettings: updateTenantSettingsMock
}));

describe("tenant settings currency", () => {
  let app: ReturnType<typeof Fastify>;
  let role: "owner" | "admin" | "engineer" | "viewer";

  beforeEach(async () => {
    role = "owner";
    getTenantSettingsMock.mockReset();
    updateTenantSettingsMock.mockReset();
    getTenantSettingsMock.mockResolvedValue({
      tenant_id: "tenant-A",
      default_currency: "USD"
    });
    updateTenantSettingsMock.mockResolvedValue({
      tenant_id: "tenant-A",
      default_currency: "PHP"
    });

    app = Fastify();
    app.decorate("requireDashboardAuth", async (request: any) => {
      request.authUser = {
        user_id: "user-1",
        email: "owner@synteq.local",
        full_name: "Owner",
        tenant_id: "tenant-A",
        role,
        email_verified_at: null
      };
    });
    app.decorate("requireRoles", (allowedRoles: string[]) => {
      return async (request: any, reply: any) => {
        if (!request.authUser) {
          return reply.code(401).send({ error: "Unauthorized" });
        }
        if (!allowedRoles.includes(request.authUser.role)) {
          return reply.code(403).send({ error: "Forbidden" });
        }
      };
    });
    app.decorate("requirePermissions", () => async () => undefined);
    app.setErrorHandler(
      (
        error: Error,
        _request: unknown,
        reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }
      ) => {
      if ((error as Error).name === "ValidationError") {
        return reply.code(400).send({ error: "Bad Request" });
      }
      return reply.code(500).send({ error: "Internal Server Error" });
      }
    );

    const settingsRoutes = (await import("../src/routes/settings.js")).default;
    await app.register(settingsRoutes, { prefix: "/v1" });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("updates tenant default_currency via PATCH", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/v1/settings/tenant",
      payload: {
        default_currency: "PHP"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(updateTenantSettingsMock).toHaveBeenCalledWith({
      tenantId: "tenant-A",
      defaultCurrency: "PHP"
    });
  });

  it("rejects invalid currency", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/v1/settings/tenant",
      payload: {
        default_currency: "SGD"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(updateTenantSettingsMock).not.toHaveBeenCalled();
  });

  it("enforces tenant scoping and role restrictions", async () => {
    role = "viewer";
    const response = await app.inject({
      method: "PATCH",
      url: "/v1/settings/tenant",
      payload: {
        default_currency: "EUR"
      }
    });

    expect(response.statusCode).toBe(403);
  });
});
