import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const inviteCount = vi.fn();
const inviteCreate = vi.fn();
const inviteFindFirst = vi.fn();
const tenantFindFirst = vi.fn();
const securityEventCreate = vi.fn();

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    user: {
      findFirst: vi.fn(),
      count: vi.fn(),
      update: vi.fn()
    },
    refreshToken: {
      updateMany: vi.fn()
    },
    invite: {
      count: inviteCount,
      create: inviteCreate,
      findFirst: inviteFindFirst,
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn()
    },
    tenant: {
      findFirst: tenantFindFirst,
      findUnique: vi.fn()
    },
    securityEvent: {
      create: securityEventCreate
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

describe("invite throttling", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    inviteCount.mockReset();
    inviteCreate.mockReset();
    inviteFindFirst.mockReset();
    tenantFindFirst.mockReset();
    securityEventCreate.mockReset();

    app = Fastify();
    app.decorate("requireDashboardAuth", async (request: any) => {
      request.authUser = {
        user_id: "admin-1",
        tenant_id: "tenant-1",
        email: "admin@synteq.local",
        full_name: "Admin User",
        role: "admin",
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

  it("limits invites per tenant per hour", async () => {
    tenantFindFirst.mockResolvedValue({
      id: "tenant-1",
      name: "Synteq"
    });
    inviteCount.mockResolvedValueOnce(20).mockResolvedValueOnce(0);

    const response = await app.inject({
      method: "POST",
      url: "/v1/team/invite",
      payload: {
        email: "engineer@synteq.local",
        role: "engineer"
      }
    });

    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({
      code: "INVITE_RATE_LIMITED"
    });
    expect(inviteCreate).not.toHaveBeenCalled();
  });

  it("limits invites per email per 24h", async () => {
    tenantFindFirst.mockResolvedValue({
      id: "tenant-1",
      name: "Synteq"
    });
    inviteCount.mockResolvedValueOnce(5).mockResolvedValueOnce(3);

    const response = await app.inject({
      method: "POST",
      url: "/v1/team/invite",
      payload: {
        email: "viewer@synteq.local",
        role: "viewer"
      }
    });

    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({
      code: "INVITE_RATE_LIMITED"
    });
    expect(inviteCreate).not.toHaveBeenCalled();
  });

  it("applies throttling on invite resend", async () => {
    inviteFindFirst.mockResolvedValue({
      id: "inv-1",
      tenant_id: "tenant-1",
      email: "viewer@synteq.local",
      role: "viewer",
      accepted_at: null,
      expires_at: new Date(Date.now() + 60_000)
    });
    inviteCount.mockResolvedValueOnce(20).mockResolvedValueOnce(0);

    const response = await app.inject({
      method: "POST",
      url: "/v1/team/invite/resend",
      payload: {
        email: "viewer@synteq.local"
      }
    });

    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({
      code: "INVITE_RATE_LIMITED"
    });
    expect(inviteCreate).not.toHaveBeenCalled();
  });
});
