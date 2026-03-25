import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const asAuthUser = vi.fn((user) => user);
const createAuthSession = vi.fn();
const hashPassword = vi.fn();
const findFirstUser = vi.fn();
const transactionMock = vi.fn();

vi.mock("../src/services/auth-service.js", () => ({
  asAuthUser,
  consumeEmailVerificationToken: vi.fn(),
  consumePasswordResetToken: vi.fn(),
  createAuthSession,
  issueEmailVerificationToken: vi.fn(),
  issuePasswordResetToken: vi.fn(),
  revokeAllRefreshTokensForUser: vi.fn(),
  revokeRefreshToken: vi.fn(),
  rotateRefreshToken: vi.fn()
}));

vi.mock("../src/utils/password.js", () => ({
  hashPassword,
  verifyPassword: vi.fn()
}));

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    user: {
      findFirst: findFirstUser,
      findMany: vi.fn(),
      update: vi.fn()
    },
    $transaction: transactionMock
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

describe("auth signup route", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    asAuthUser.mockClear();
    createAuthSession.mockReset();
    hashPassword.mockReset();
    findFirstUser.mockReset();
    transactionMock.mockReset();

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

  it("creates owner user + tenant and returns auth session", async () => {
    findFirstUser.mockResolvedValue(null);
    hashPassword.mockResolvedValue("hashed-secret");
    transactionMock.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
      return callback({
        tenant: {
          create: vi.fn().mockResolvedValue({
            id: "tenant-1"
          })
        },
        user: {
          create: vi.fn().mockResolvedValue({
            id: "user-1",
            tenant_id: "tenant-1",
            email: "owner@lexora.ltd",
            full_name: "Owner User",
            role: "owner",
            email_verified_at: null
          })
        }
      });
    });
    createAuthSession.mockResolvedValue({
      access_token: "access",
      refresh_token: "refresh",
      refresh_expires_at: new Date(Date.now() + 60_000).toISOString(),
      user: {
        id: "user-1",
        tenant_id: "tenant-1",
        email: "owner@lexora.ltd",
        full_name: "Owner User",
        role: "owner",
        email_verified_at: null
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        workspace_name: "Lexora Engineering",
        full_name: "Owner User",
        email: "owner@lexora.ltd",
        password: "StrongPass123!"
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      access_token: "access",
      refresh_token: "refresh"
    });
    expect(hashPassword).toHaveBeenCalledWith("StrongPass123!");
    expect(createAuthSession).toHaveBeenCalledTimes(1);
  });

  it("rejects signup when email already exists", async () => {
    findFirstUser.mockResolvedValue({ id: "existing-user" });

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        workspace_name: "Lexora Engineering",
        full_name: "Owner User",
        email: "owner@lexora.ltd",
        password: "StrongPass123!"
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: "AUTH_SIGNUP_EMAIL_EXISTS"
    });
    expect(createAuthSession).not.toHaveBeenCalled();
  });
});
