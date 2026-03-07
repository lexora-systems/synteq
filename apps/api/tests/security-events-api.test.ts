import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const countMock = vi.fn();
const findManyMock = vi.fn();
const userFindManyMock = vi.fn();

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    securityEvent: {
      count: countMock,
      findMany: findManyMock
    },
    user: {
      findMany: userFindManyMock
    }
  }
}));

describe("security events api", () => {
  let app: ReturnType<typeof Fastify>;
  let role: "owner" | "admin" | "viewer";

  beforeEach(async () => {
    role = "owner";
    countMock.mockReset();
    findManyMock.mockReset();
    userFindManyMock.mockReset();

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

    const securityEventsRoutes = (await import("../src/routes/security-events.js")).default;
    await app.register(securityEventsRoutes, { prefix: "/v1" });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("allows owner/admin to list tenant security events", async () => {
    countMock.mockResolvedValue(1);
    findManyMock.mockResolvedValue([
      {
        id: "evt-1",
        tenant_id: "tenant-A",
        user_id: "user-1",
        type: "LOGIN_FAILED",
        ip: "127.0.0.1",
        user_agent: "vitest",
        metadata_json: { email: "owner@synteq.local" },
        created_at: new Date()
      }
    ]);
    userFindManyMock.mockResolvedValue([
      {
        id: "user-1",
        email: "owner@synteq.local",
        full_name: "Owner"
      }
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/v1/security-events?type=LOGIN_FAILED"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      events: [{ type: "LOGIN_FAILED" }]
    });
  });

  it("blocks viewers from reading security events", async () => {
    role = "viewer";
    const response = await app.inject({
      method: "GET",
      url: "/v1/security-events"
    });

    expect(response.statusCode).toBe(403);
  });

  it("enforces tenant scoping in security event queries", async () => {
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);
    userFindManyMock.mockResolvedValue([]);

    await app.inject({
      method: "GET",
      url: "/v1/security-events?page=1&limit=25"
    });

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenant_id: "tenant-A"
        })
      })
    );
    expect(countMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenant_id: "tenant-A"
        })
      })
    );
  });
});
