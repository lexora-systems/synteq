import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "../src/utils/password.js";

const findFirstMock = vi.fn();
const findManyMock = vi.fn();
const userUpdateMock = vi.fn();

const asAuthUserMock = vi.fn((user) => user);
const createAuthSessionMock = vi.fn();
const consumeEmailVerificationTokenMock = vi.fn();
const consumePasswordResetTokenMock = vi.fn();
const issueEmailVerificationTokenMock = vi.fn();
const issuePasswordResetTokenMock = vi.fn();
const revokeAllRefreshTokensForUserMock = vi.fn();
const revokeRefreshTokenMock = vi.fn();
const rotateRefreshTokenMock = vi.fn();

const sendPasswordResetEmailMock = vi.fn();
const sendVerificationEmailMock = vi.fn();
const logSecurityEventMock = vi.fn();

const getLoginLockStateMock = vi.fn();
const recordFailedLoginAttemptMock = vi.fn();
const resetLoginAbuseStateMock = vi.fn();

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    user: {
      findFirst: findFirstMock,
      findMany: findManyMock,
      update: userUpdateMock
    }
  }
}));

vi.mock("../src/services/auth-service.js", () => ({
  asAuthUser: asAuthUserMock,
  consumeEmailVerificationToken: consumeEmailVerificationTokenMock,
  consumePasswordResetToken: consumePasswordResetTokenMock,
  createAuthSession: createAuthSessionMock,
  issueEmailVerificationToken: issueEmailVerificationTokenMock,
  issuePasswordResetToken: issuePasswordResetTokenMock,
  revokeAllRefreshTokensForUser: revokeAllRefreshTokensForUserMock,
  revokeRefreshToken: revokeRefreshTokenMock,
  rotateRefreshToken: rotateRefreshTokenMock
}));

vi.mock("../src/services/email-service.js", () => ({
  sendPasswordResetEmail: sendPasswordResetEmailMock,
  sendVerificationEmail: sendVerificationEmailMock
}));

vi.mock("../src/services/security-event-service.js", () => ({
  logSecurityEvent: logSecurityEventMock
}));

vi.mock("../src/services/auth-abuse-service.js", () => ({
  getLoginLockState: getLoginLockStateMock,
  recordFailedLoginAttempt: recordFailedLoginAttemptMock,
  resetLoginAbuseState: resetLoginAbuseStateMock
}));

vi.mock("../src/config.js", () => ({
  config: {
    LOGOUT_ALL_ENABLED: true
  }
}));

describe("tenant-aware login auth flow", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    findFirstMock.mockReset();
    findManyMock.mockReset();
    userUpdateMock.mockReset();
    asAuthUserMock.mockClear();
    createAuthSessionMock.mockReset();
    consumeEmailVerificationTokenMock.mockReset();
    consumePasswordResetTokenMock.mockReset();
    issueEmailVerificationTokenMock.mockReset();
    issuePasswordResetTokenMock.mockReset();
    revokeAllRefreshTokensForUserMock.mockReset();
    revokeRefreshTokenMock.mockReset();
    rotateRefreshTokenMock.mockReset();
    sendPasswordResetEmailMock.mockReset();
    sendVerificationEmailMock.mockReset();
    logSecurityEventMock.mockReset();
    getLoginLockStateMock.mockReset();
    recordFailedLoginAttemptMock.mockReset();
    resetLoginAbuseStateMock.mockReset();

    getLoginLockStateMock.mockResolvedValue({ locked: false, retryAfterSec: 0 });
    recordFailedLoginAttemptMock.mockResolvedValue({
      ipAttempts: 1,
      emailAttempts: 1,
      locked: false,
      retryAfterSec: 60
    });
    createAuthSessionMock.mockImplementation(async (_reply, user) => ({
      access_token: "access-token",
      refresh_token: "refresh-token",
      refresh_expires_at: new Date(Date.now() + 60_000).toISOString(),
      user
    }));
    issuePasswordResetTokenMock.mockResolvedValue({
      rawToken: "reset-token",
      expiresAt: new Date(Date.now() + 60_000)
    });

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

  it("authenticates same email across tenants with explicit tenant context", async () => {
    const password = "StrongPass123!";
    const passwordHash = await hashPassword(password);
    const tenantAUser = {
      id: "user-a",
      tenant_id: "tenant-a",
      email: "shared@example.com",
      full_name: "Tenant A User",
      password_hash: passwordHash,
      role: "engineer",
      email_verified_at: null,
      disabled_at: null,
      created_at: new Date(),
      updated_at: new Date()
    };
    const tenantBUser = {
      ...tenantAUser,
      id: "user-b",
      tenant_id: "tenant-b",
      full_name: "Tenant B User"
    };

    findFirstMock.mockImplementation(async (args: { where: { tenant_id?: string } }) => {
      if (args.where.tenant_id === "tenant-a") {
        return tenantAUser;
      }

      if (args.where.tenant_id === "tenant-b") {
        return tenantBUser;
      }

      return null;
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        tenant_id: "tenant-b",
        email: "shared@example.com",
        password
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      access_token: "access-token",
      refresh_token: "refresh-token",
      user: {
        tenant_id: "tenant-b",
        email: "shared@example.com",
        role: "engineer"
      }
    });
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("fails login when tenant context is wrong", async () => {
    findFirstMock.mockResolvedValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        tenant_id: "tenant-does-not-match",
        email: "shared@example.com",
        password: "StrongPass123!"
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: "Invalid credentials"
    });
    expect(recordFailedLoginAttemptMock).toHaveBeenCalledWith(
      "127.0.0.1",
      "shared@example.com",
      "tenant-does-not-match"
    );
  });

  it("requires tenant context when an email is present in multiple tenants", async () => {
    findManyMock.mockResolvedValue([
      { id: "user-a", tenant_id: "tenant-a", email: "shared@example.com", disabled_at: null },
      { id: "user-b", tenant_id: "tenant-b", email: "shared@example.com", disabled_at: null }
    ]);

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: "shared@example.com",
        password: "StrongPass123!"
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      code: "AUTH_TENANT_REQUIRED"
    });
    expect(createAuthSessionMock).not.toHaveBeenCalled();
  });

  it("keeps password reset tenant-safe when email exists in multiple tenants", async () => {
    findManyMock.mockResolvedValue([
      { id: "user-a", tenant_id: "tenant-a", email: "shared@example.com", disabled_at: null },
      { id: "user-b", tenant_id: "tenant-b", email: "shared@example.com", disabled_at: null }
    ]);

    const ambiguousResponse = await app.inject({
      method: "POST",
      url: "/v1/auth/password-reset/request",
      payload: {
        email: "shared@example.com"
      }
    });

    expect(ambiguousResponse.statusCode).toBe(200);
    expect(issuePasswordResetTokenMock).not.toHaveBeenCalled();

    const tenantScopedUser = {
      id: "user-a",
      tenant_id: "tenant-a",
      email: "shared@example.com",
      disabled_at: null
    };
    findFirstMock.mockResolvedValue(tenantScopedUser);

    const scopedResponse = await app.inject({
      method: "POST",
      url: "/v1/auth/password-reset/request",
      payload: {
        tenant_id: "tenant-a",
        email: "shared@example.com"
      }
    });

    expect(scopedResponse.statusCode).toBe(200);
    expect(issuePasswordResetTokenMock).toHaveBeenCalledWith("user-a");
    expect(sendPasswordResetEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "shared@example.com"
      })
    );
  });
});
