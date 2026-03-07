import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rotateRefreshToken = vi.fn();

vi.mock("../src/services/auth-service.js", () => ({
  asAuthUser: vi.fn(),
  consumeEmailVerificationToken: vi.fn(),
  consumePasswordResetToken: vi.fn(),
  createAuthSession: vi.fn(),
  issueEmailVerificationToken: vi.fn(),
  issuePasswordResetToken: vi.fn(),
  revokeAllRefreshTokensForUser: vi.fn(),
  revokeRefreshToken: vi.fn(),
  rotateRefreshToken
}));

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    user: {
      findFirst: vi.fn(),
      update: vi.fn()
    }
  }
}));

vi.mock("../src/services/email-service.js", () => ({
  sendPasswordResetEmail: vi.fn(),
  sendVerificationEmail: vi.fn()
}));

vi.mock("../src/services/security-event-service.js", () => ({
  logSecurityEvent: vi.fn()
}));

vi.mock("../src/services/auth-abuse-service.js", () => ({
  getLoginLockState: vi.fn().mockResolvedValue({ locked: false, retryAfterSec: 0 }),
  recordFailedLoginAttempt: vi.fn(),
  resetLoginAbuseState: vi.fn()
}));

vi.mock("../src/config.js", () => ({
  config: {
    LOGOUT_ALL_ENABLED: true
  }
}));

describe("session refresh flow", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    rotateRefreshToken.mockReset();
    app = Fastify();
    app.decorate("requireDashboardAuth", async () => undefined);
    app.decorate("requirePermissions", () => async () => undefined);
    app.decorate("requireRoles", () => async () => undefined);

    const authRoutes = (await import("../src/routes/auth.js")).default;
    await app.register(authRoutes, { prefix: "/v1" });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns new session tokens when refresh token is valid", async () => {
    rotateRefreshToken.mockResolvedValue({
      status: "success",
      access_token: "new-access-token",
      refresh_token: "new-refresh-token",
      refresh_expires_at: new Date(Date.now() + 60_000).toISOString(),
      user: {
        id: "user-1",
        tenant_id: "tenant-1",
        email: "owner@synteq.local",
        full_name: "Owner User",
        role: "owner",
        email_verified_at: null
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: {
        refresh_token: "v".repeat(48)
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      access_token: "new-access-token",
      refresh_token: "new-refresh-token"
    });
  });

  it("returns invalid response for bad refresh token", async () => {
    rotateRefreshToken.mockResolvedValue({ status: "invalid" });

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: {
        refresh_token: "b".repeat(48)
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      code: "AUTH_REFRESH_INVALID"
    });
  });

  it("returns reuse-detected response and forces re-login", async () => {
    rotateRefreshToken.mockResolvedValue({ status: "reuse_detected" });

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: {
        refresh_token: "r".repeat(48)
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      code: "AUTH_REFRESH_REUSE_DETECTED"
    });
  });
});
