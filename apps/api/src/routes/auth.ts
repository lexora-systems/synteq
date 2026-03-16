import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  emailVerifyConfirmSchema,
  loginSchema,
  passwordChangeSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  refreshTokenSchema
} from "@synteq/shared";
import { parseWithSchema } from "../utils/validation.js";
import { prisma } from "../lib/prisma.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import {
  asAuthUser,
  consumeEmailVerificationToken,
  consumePasswordResetToken,
  createAuthSession,
  issueEmailVerificationToken,
  issuePasswordResetToken,
  revokeAllRefreshTokensForUser,
  revokeRefreshToken,
  rotateRefreshToken
} from "../services/auth-service.js";
import { sendPasswordResetEmail, sendVerificationEmail } from "../services/email-service.js";
import { logSecurityEvent } from "../services/security-event-service.js";
import { config } from "../config.js";
import { getLoginLockState, recordFailedLoginAttempt, resetLoginAbuseState } from "../services/auth-abuse-service.js";

const logoutSchema = z.object({
  refresh_token: z.string().min(32).max(512).optional(),
  logout_all: z.boolean().optional().default(false)
});

type ResolveUserResult = {
  user: Awaited<ReturnType<typeof prisma.user.findFirst>>;
  tenantContextRequired: boolean;
};

async function resolveUserForTenantScopedAuth(input: {
  email: string;
  tenantId?: string;
}): Promise<ResolveUserResult> {
  if (input.tenantId) {
    const user = await prisma.user.findFirst({
      where: {
        tenant_id: input.tenantId,
        email: input.email,
        disabled_at: null
      }
    });

    return {
      user,
      tenantContextRequired: false
    };
  }

  const users = await prisma.user.findMany({
    where: {
      email: input.email,
      disabled_at: null
    },
    orderBy: {
      created_at: "asc"
    },
    take: 2
  });

  if (users.length !== 1) {
    return {
      user: null,
      tenantContextRequired: users.length > 1
    };
  }

  return {
    user: users[0],
    tenantContextRequired: false
  };
}

const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/auth/login", async (request, reply) => {
    const body = parseWithSchema(loginSchema, request.body);
    const tenantId = body.tenant_id?.trim();
    const email = body.email.toLowerCase();

    const loginLock = await getLoginLockState(request.ip, email, tenantId);
    if (loginLock.locked) {
      await logSecurityEvent({
        tenantId: tenantId ?? null,
        userId: null,
        type: "LOGIN_LOCKED",
        ip: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
        metadata: {
          email,
          tenant_id: tenantId ?? null,
          retry_after_sec: loginLock.retryAfterSec
        }
      });

      reply.header("Retry-After", String(loginLock.retryAfterSec));
      return reply.code(429).send({
        error: "Too many login attempts. Try again later.",
        code: "AUTH_TEMPORARILY_LOCKED"
      });
    }

    const resolved = await resolveUserForTenantScopedAuth({
      email,
      tenantId
    });

    if (resolved.tenantContextRequired) {
      await logSecurityEvent({
        tenantId: null,
        userId: null,
        type: "LOGIN_FAILED",
        ip: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
        metadata: {
          email,
          reason: "TENANT_CONTEXT_REQUIRED"
        }
      });

      return reply.code(401).send({
        error: "Tenant context required for this account.",
        code: "AUTH_TENANT_REQUIRED"
      });
    }

    const user = resolved.user;
    if (!user || !(await verifyPassword(body.password, user.password_hash))) {
      const failed = await recordFailedLoginAttempt(request.ip, email, tenantId ?? user?.tenant_id ?? null);
      await logSecurityEvent({
        tenantId: user?.tenant_id ?? null,
        userId: user?.id ?? null,
        type: "LOGIN_FAILED",
        ip: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
        metadata: {
          email,
          tenant_id: tenantId ?? null,
          attempts_ip: failed.ipAttempts,
          attempts_email: failed.emailAttempts,
          locked: failed.locked
        }
      });

      if (failed.locked) {
        await logSecurityEvent({
          tenantId: user?.tenant_id ?? null,
          userId: user?.id ?? null,
          type: "LOGIN_LOCKED",
          ip: request.ip,
          userAgent: request.headers["user-agent"] ?? null,
          metadata: {
            email,
            tenant_id: tenantId ?? null,
            attempts_ip: failed.ipAttempts,
            attempts_email: failed.emailAttempts,
            retry_after_sec: failed.retryAfterSec
          }
        });

        reply.header("Retry-After", String(failed.retryAfterSec));
        return reply.code(429).send({
          error: "Too many login attempts. Try again later.",
          code: "AUTH_TEMPORARILY_LOCKED"
        });
      }

      return reply.code(401).send({ error: "Invalid credentials" });
    }

    await resetLoginAbuseState(request.ip, email, tenantId ?? user.tenant_id);
    const session = await createAuthSession(reply, asAuthUser(user));
    return {
      token: session.access_token,
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      refresh_expires_at: session.refresh_expires_at,
      user: session.user
    };
  });

  app.post("/auth/logout", async (request, reply) => {
    const body = parseWithSchema(logoutSchema, request.body ?? {});
    let currentUserId: string | null = null;

    if (body.refresh_token) {
      await revokeRefreshToken(body.refresh_token);
    }

    if (request.headers.authorization) {
      try {
        await request.jwtVerify();
        const claims = request.user as { user_id?: string };
        if (claims.user_id) {
          currentUserId = claims.user_id;
        }
      } catch {
        // no-op: logout should be idempotent
      }
    }

    if (body.logout_all) {
      if (!currentUserId) {
        return reply.code(401).send({
          error: "Unauthorized",
          code: "AUTH_LOGOUT_ALL_REQUIRES_AUTH"
        });
      }

      await revokeAllRefreshTokensForUser(currentUserId);
    } else if (config.LOGOUT_ALL_ENABLED && currentUserId && !body.refresh_token) {
      // Backward-compatible behavior: bearer-only logout can revoke all sessions.
      await revokeAllRefreshTokensForUser(currentUserId);
    }

    return { ok: true };
  });

  app.post(
    "/auth/logout-all",
    {
      preHandler: app.requireDashboardAuth
    },
    async (request, reply) => {
      const authUser = request.authUser;
      if (!authUser) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      if (!config.LOGOUT_ALL_ENABLED) {
        return reply.code(403).send({ error: "Logout-all is disabled" });
      }

      await revokeAllRefreshTokensForUser(authUser.user_id);
      return { ok: true };
    }
  );

  app.post("/auth/refresh", async (request, reply) => {
    const body = parseWithSchema(refreshTokenSchema, request.body);
    const session = await rotateRefreshToken(reply, body.refresh_token, {
      ip: request.ip,
      userAgent: request.headers["user-agent"] ?? null
    });
    if (session.status === "invalid") {
      return reply.code(401).send({
        error: "Invalid refresh token",
        code: "AUTH_REFRESH_INVALID"
      });
    }

    if (session.status === "reuse_detected") {
      return reply.code(401).send({
        error: "Refresh token reuse detected. All sessions have been revoked.",
        code: "AUTH_REFRESH_REUSE_DETECTED"
      });
    }

    return {
      token: session.access_token,
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      refresh_expires_at: session.refresh_expires_at,
      user: session.user
    };
  });

  app.get(
    "/auth/me",
    {
      preHandler: app.requireDashboardAuth
    },
    async (request) => {
      return {
        user: request.authUser
      };
    }
  );

  app.post(
    "/auth/change-password",
    {
      preHandler: app.requireDashboardAuth
    },
    async (request, reply) => {
      const body = parseWithSchema(passwordChangeSchema, request.body);
      const authUser = request.authUser;

      if (!authUser) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const user = await prisma.user.findFirst({
        where: {
          id: authUser.user_id,
          tenant_id: authUser.tenant_id,
          disabled_at: null
        }
      });

      if (!user || !(await verifyPassword(body.current_password, user.password_hash))) {
        return reply.code(401).send({ error: "Current password is incorrect" });
      }

      const nextHash = await hashPassword(body.new_password);
      await prisma.user.update({
        where: { id: user.id },
        data: { password_hash: nextHash }
      });
      await revokeAllRefreshTokensForUser(user.id);

      return { ok: true };
    }
  );

  app.post(
    "/auth/email/verification/request",
    {
      preHandler: app.requireDashboardAuth
    },
    async (request, reply) => {
      const authUser = request.authUser;
      if (!authUser) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const token = await issueEmailVerificationToken(authUser.user_id);
      await sendVerificationEmail({
        email: authUser.email,
        token: token.rawToken
      });

      return { ok: true };
    }
  );

  app.post("/auth/email/verification/confirm", async (request, reply) => {
    const body = parseWithSchema(emailVerifyConfirmSchema, request.body);
    const userId = await consumeEmailVerificationToken(body.token);
    if (!userId) {
      return reply.code(400).send({ error: "Invalid or expired verification token" });
    }

    return { ok: true };
  });

  app.post("/auth/password-reset/request", async (request) => {
    const body = parseWithSchema(passwordResetRequestSchema, request.body);
    const tenantId = body.tenant_id?.trim();
    const email = body.email.toLowerCase();

    const resolved = await resolveUserForTenantScopedAuth({
      email,
      tenantId
    });
    const user = resolved.tenantContextRequired ? null : resolved.user;

    if (user) {
      const token = await issuePasswordResetToken(user.id);
      await sendPasswordResetEmail({
        email: user.email,
        token: token.rawToken
      });
    }

    return { ok: true };
  });

  app.post("/auth/password-reset/confirm", async (request, reply) => {
    const body = parseWithSchema(passwordResetConfirmSchema, request.body);
    const nextHash = await hashPassword(body.password);
    const userId = await consumePasswordResetToken(body.token, nextHash);
    if (!userId) {
      return reply.code(400).send({ error: "Invalid or expired reset token" });
    }

    return { ok: true };
  });
};

export default authRoutes;
