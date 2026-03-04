import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const userFindFirst = vi.fn();
const userCount = vi.fn();
const userUpdate = vi.fn();
const refreshTokenUpdateMany = vi.fn();

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    user: {
      findFirst: userFindFirst,
      count: userCount,
      update: userUpdate
    },
    refreshToken: {
      updateMany: refreshTokenUpdateMany
    },
    invite: {
      count: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn()
    },
    tenant: {
      findFirst: vi.fn(),
      findUnique: vi.fn()
    },
    securityEvent: {
      create: vi.fn()
    },
    $transaction: vi.fn()
  }
}));

vi.mock("../src/services/email-service.js", () => ({
  sendInviteEmail: vi.fn()
}));

vi.mock("../src/services/auth-service.js", () => ({
  createAuthSession: vi.fn(),
  asAuthUser: vi.fn()
}));

vi.mock("../src/config.js", () => ({
  config: {
    INVITE_RATE_LIMIT_PER_HOUR: 20,
    INVITE_PER_EMAIL_PER_DAY: 3
  }
}));

describe("last owner protection", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    userFindFirst.mockReset();
    userCount.mockReset();
    userUpdate.mockReset();
    refreshTokenUpdateMany.mockReset();

    app = Fastify();
    app.decorate("requireDashboardAuth", async (request: any) => {
      request.authUser = {
        user_id: "owner-1",
        tenant_id: "tenant-1",
        email: "owner@synteq.local",
        full_name: "Owner",
        role: "owner",
        email_verified_at: null
      };
    });
    app.decorate("requirePermissions", () => async () => undefined);
    app.decorate("requireRoles", () => async () => undefined);

    const teamRoutes = (await import("../src/routes/team.js")).default;
    await app.register(teamRoutes, { prefix: "/v1" });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("blocks demoting the last active owner", async () => {
    userFindFirst.mockResolvedValue({
      id: "owner-1",
      tenant_id: "tenant-1",
      role: "owner",
      disabled_at: null
    });
    userCount.mockResolvedValue(1);

    const response = await app.inject({
      method: "POST",
      url: "/v1/team/users/owner-1/role",
      payload: {
        role: "admin"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "LAST_OWNER_PROTECTION"
    });
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("blocks disabling the last active owner", async () => {
    userFindFirst.mockResolvedValue({
      id: "owner-1",
      tenant_id: "tenant-1",
      role: "owner",
      disabled_at: null
    });
    userCount.mockResolvedValue(1);

    const response = await app.inject({
      method: "POST",
      url: "/v1/team/users/owner-1/disable"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "LAST_OWNER_PROTECTION"
    });
    expect(userUpdate).not.toHaveBeenCalled();
    expect(refreshTokenUpdateMany).not.toHaveBeenCalled();
  });
});
