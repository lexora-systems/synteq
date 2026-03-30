import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { inviteAcceptSchema, inviteCreateSchema, teamUpdateRoleSchema } from "@synteq/shared";
import { parseWithSchema } from "../utils/validation.js";
import { prisma } from "../lib/prisma.js";
import { hashPassword } from "../utils/password.js";
import { randomOpaqueToken, sha256 } from "../utils/crypto.js";
import { createAuthSession, asAuthUser } from "../services/auth-service.js";
import { sendInviteEmail } from "../services/email-service.js";
import { Permission } from "../auth/permissions.js";
import { config } from "../config.js";
import { logSecurityEvent } from "../services/security-event-service.js";
import { replyIfEntitlementError, requireTeamAccess, resolveTenantAccess } from "../services/entitlement-guard-service.js";

const tokenParamSchema = z.object({
  token: z.string().min(32).max(512)
});

const userIdParamSchema = z.object({
  id: z.string().min(1)
});

const inviteResendSchema = z.object({
  email: z.string().email()
});

const inviteTtlMs = 7 * 24 * 60 * 60 * 1000;
const hourMs = 60 * 60 * 1000;
const dayMs = 24 * hourMs;

type InviteLimitViolation = "tenant_hour_limit" | "email_daily_limit";

async function checkInviteRateLimit(tenantId: string, email: string): Promise<InviteLimitViolation | null> {
  const now = Date.now();
  const hourAgo = new Date(now - hourMs);
  const dayAgo = new Date(now - dayMs);

  const [tenantInviteCount, emailInviteCount] = await Promise.all([
    prisma.invite.count({
      where: {
        tenant_id: tenantId,
        created_at: {
          gte: hourAgo
        }
      }
    }),
    prisma.invite.count({
      where: {
        tenant_id: tenantId,
        email,
        created_at: {
          gte: dayAgo
        }
      }
    })
  ]);

  if (tenantInviteCount >= config.INVITE_RATE_LIMIT_PER_HOUR) {
    return "tenant_hour_limit";
  }

  if (emailInviteCount >= config.INVITE_PER_EMAIL_PER_DAY) {
    return "email_daily_limit";
  }

  return null;
}

async function countActiveOwners(tenantId: string): Promise<number> {
  return prisma.user.count({
    where: {
      tenant_id: tenantId,
      role: "owner",
      disabled_at: null
    }
  });
}

const teamRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/team/users",
    {
      preHandler: [app.requireDashboardAuth, app.requirePermissions([Permission.TEAM_READ])]
    },
    async (request, reply) => {
      const tenantId = request.authUser?.tenant_id;
      if (!tenantId) {
        return reply.code(401).send({ error: "Missing tenant context" });
      }

      const users = await prisma.user.findMany({
        where: {
          tenant_id: tenantId
        },
        orderBy: {
          created_at: "asc"
        },
        select: {
          id: true,
          email: true,
          full_name: true,
          role: true,
          email_verified_at: true,
          created_at: true,
          updated_at: true,
          disabled_at: true
        }
      });

      return { users, request_id: request.id };
    }
  );

  app.post(
    "/team/invite",
    {
      preHandler: [app.requireDashboardAuth, app.requirePermissions([Permission.TEAM_INVITE])]
    },
    async (request, reply) => {
      const authUser = request.authUser;
      if (!authUser) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      try {
        const access = await resolveTenantAccess({
          tenantId: authUser.tenant_id
        });
        requireTeamAccess(access);
      } catch (error) {
        if (replyIfEntitlementError(reply, request.id, error)) {
          return;
        }
        throw error;
      }

      const body = parseWithSchema(inviteCreateSchema, request.body);
      const email = body.email.toLowerCase();

      if (body.role === "owner" && authUser.role !== "owner") {
        return reply.code(403).send({ error: "Only owners can invite owner role" });
      }

      const tenant = await prisma.tenant.findFirst({
        where: { id: authUser.tenant_id },
        select: { id: true, name: true }
      });

      if (!tenant) {
        return reply.code(401).send({ error: "Invalid tenant context" });
      }

      const inviteLimitViolation = await checkInviteRateLimit(tenant.id, email);
      if (inviteLimitViolation) {
        await logSecurityEvent({
          tenantId: tenant.id,
          userId: authUser.user_id,
          type: "INVITE_RATE_LIMITED",
          ip: request.ip,
          userAgent: request.headers["user-agent"] ?? null,
          metadata: {
            email,
            reason: inviteLimitViolation
          }
        });

        return reply.code(429).send({
          error: "Invite rate limit exceeded",
          code: "INVITE_RATE_LIMITED"
        });
      }

      const rawToken = randomOpaqueToken(48);
      const tokenHash = sha256(rawToken);
      const expiresAt = new Date(Date.now() + inviteTtlMs);

      const invite = await prisma.invite.create({
        data: {
          tenant_id: tenant.id,
          email,
          role: body.role,
          token_hash: tokenHash,
          invited_by_user_id: authUser.user_id,
          expires_at: expiresAt
        }
      });

      await sendInviteEmail({
        email,
        token: rawToken,
        role: body.role,
        invitedByName: authUser.full_name,
        tenantName: tenant.name
      });

      return {
        invite: {
          id: invite.id,
          email: invite.email,
          role: invite.role,
          expires_at: invite.expires_at
        },
        request_id: request.id
      };
    }
  );

  app.get(
    "/team/invites",
    {
      preHandler: [app.requireDashboardAuth, app.requirePermissions([Permission.TEAM_READ])]
    },
    async (request, reply) => {
      const authUser = request.authUser;
      if (!authUser) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const invites = await prisma.invite.findMany({
        where: {
          tenant_id: authUser.tenant_id
        },
        orderBy: {
          created_at: "desc"
        },
        include: {
          invited_by_user: {
            select: {
              id: true,
              email: true,
              full_name: true
            }
          }
        }
      });

      return {
        invites,
        request_id: request.id
      };
    }
  );

  app.post(
    "/team/invite/resend",
    {
      preHandler: [app.requireDashboardAuth, app.requirePermissions([Permission.TEAM_INVITE])]
    },
    async (request, reply) => {
      const authUser = request.authUser;
      if (!authUser) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      try {
        const access = await resolveTenantAccess({
          tenantId: authUser.tenant_id
        });
        requireTeamAccess(access);
      } catch (error) {
        if (replyIfEntitlementError(reply, request.id, error)) {
          return;
        }
        throw error;
      }

      const body = parseWithSchema(inviteResendSchema, request.body);
      const email = body.email.toLowerCase();
      const now = new Date();

      const existingInvite = await prisma.invite.findFirst({
        where: {
          tenant_id: authUser.tenant_id,
          email,
          accepted_at: null,
          expires_at: {
            gt: now
          }
        },
        orderBy: {
          created_at: "desc"
        }
      });

      if (!existingInvite) {
        return reply.code(404).send({
          error: "No active invite found for this email",
          code: "INVITE_NOT_FOUND"
        });
      }

      const inviteLimitViolation = await checkInviteRateLimit(authUser.tenant_id, email);
      if (inviteLimitViolation) {
        await logSecurityEvent({
          tenantId: authUser.tenant_id,
          userId: authUser.user_id,
          type: "INVITE_RATE_LIMITED",
          ip: request.ip,
          userAgent: request.headers["user-agent"] ?? null,
          metadata: {
            email,
            reason: inviteLimitViolation,
            source: "resend"
          }
        });

        return reply.code(429).send({
          error: "Invite rate limit exceeded",
          code: "INVITE_RATE_LIMITED"
        });
      }

      const tenant = await prisma.tenant.findUnique({
        where: {
          id: authUser.tenant_id
        },
        select: {
          id: true,
          name: true
        }
      });

      if (!tenant) {
        return reply.code(401).send({ error: "Invalid tenant context" });
      }

      const rawToken = randomOpaqueToken(48);
      const tokenHash = sha256(rawToken);
      const expiresAt = new Date(Date.now() + inviteTtlMs);

      const invite = await prisma.$transaction(async (tx) => {
        await tx.invite.updateMany({
          where: {
            id: existingInvite.id,
            accepted_at: null
          },
          data: {
            expires_at: now
          }
        });

        return tx.invite.create({
          data: {
            tenant_id: authUser.tenant_id,
            email,
            role: existingInvite.role,
            token_hash: tokenHash,
            invited_by_user_id: authUser.user_id,
            expires_at: expiresAt
          }
        });
      });

      await sendInviteEmail({
        email,
        token: rawToken,
        role: invite.role,
        invitedByName: authUser.full_name,
        tenantName: tenant.name
      });

      return {
        invite: {
          id: invite.id,
          email: invite.email,
          role: invite.role,
          expires_at: invite.expires_at
        },
        request_id: request.id
      };
    }
  );

  app.post("/team/invite/:token/accept", async (request, reply) => {
    const params = parseWithSchema(tokenParamSchema, request.params);
    const body = parseWithSchema(inviteAcceptSchema, request.body);
    const tokenHash = sha256(params.token);
    const now = new Date();

    const invite = await prisma.invite.findUnique({
      where: {
        token_hash: tokenHash
      }
    });

    if (!invite) {
      return reply.code(400).send({
        error: "Invalid invite token",
        code: "INVITE_INVALID"
      });
    }

    if (invite.accepted_at) {
      return reply.code(400).send({
        error: "Invite has already been accepted",
        code: "INVITE_ALREADY_ACCEPTED"
      });
    }

    if (invite.expires_at <= now) {
      return reply.code(400).send({
        error: "Invite has expired",
        code: "INVITE_EXPIRED"
      });
    }
    try {
      const access = await resolveTenantAccess({
        tenantId: invite.tenant_id
      });
      requireTeamAccess(access);
    } catch (error) {
      if (replyIfEntitlementError(reply, request.id, error)) {
        return;
      }
      throw error;
    }

    const passwordHash = await hashPassword(body.password);

    const user = await prisma.$transaction(async (tx) => {
      const currentInvite = await tx.invite.findFirst({
        where: {
          id: invite.id,
          accepted_at: null
        }
      });

      if (!currentInvite) {
        return null;
      }

      const existingUser = await tx.user.findFirst({
        where: {
          tenant_id: currentInvite.tenant_id,
          email: currentInvite.email
        }
      });

      const nextUser = existingUser
        ? await tx.user.update({
            where: { id: existingUser.id },
            data: {
              full_name: body.full_name,
              password_hash: passwordHash,
              role: currentInvite.role,
              email_verified_at: now,
              disabled_at: null
            }
          })
        : await tx.user.create({
            data: {
              tenant_id: currentInvite.tenant_id,
              email: currentInvite.email,
              full_name: body.full_name,
              password_hash: passwordHash,
              role: currentInvite.role,
              email_verified_at: now
            }
          });

      const consumeResult = await tx.invite.updateMany({
        where: {
          id: currentInvite.id,
          accepted_at: null
        },
        data: {
          accepted_at: now
        }
      });

      if (consumeResult.count !== 1) {
        return null;
      }

      return nextUser;
    });

    if (!user) {
      return reply.code(400).send({
        error: "Invite has already been accepted",
        code: "INVITE_ALREADY_ACCEPTED"
      });
    }

    const session = await createAuthSession(reply, asAuthUser(user));
    return {
      token: session.access_token,
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      refresh_expires_at: session.refresh_expires_at,
      user: session.user
    };
  });

  app.post(
    "/team/users/:id/role",
    {
      preHandler: [app.requireDashboardAuth, app.requirePermissions([Permission.TEAM_MANAGE])]
    },
    async (request, reply) => {
      const authUser = request.authUser;
      if (!authUser) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const params = parseWithSchema(userIdParamSchema, request.params);
      const body = parseWithSchema(teamUpdateRoleSchema, request.body);

      if (body.role === "owner" && authUser.role !== "owner") {
        return reply.code(403).send({ error: "Only owners can assign owner role" });
      }

      const target = await prisma.user.findFirst({
        where: {
          id: params.id,
          tenant_id: authUser.tenant_id
        }
      });

      if (!target) {
        return reply.code(404).send({ error: "User not found" });
      }

      if (target.role === "owner" && authUser.role !== "owner") {
        return reply.code(403).send({ error: "Only owners can modify owner role" });
      }

      if (target.role === "owner" && body.role !== "owner" && target.disabled_at === null) {
        const activeOwners = await countActiveOwners(authUser.tenant_id);
        if (activeOwners <= 1) {
          return reply.code(400).send({
            error: "Cannot demote the last active owner",
            code: "LAST_OWNER_PROTECTION"
          });
        }
      }

      const user = await prisma.user.update({
        where: { id: target.id },
        data: {
          role: body.role
        },
        select: {
          id: true,
          email: true,
          full_name: true,
          role: true,
          email_verified_at: true,
          created_at: true,
          updated_at: true,
          disabled_at: true
        }
      });

      return { user, request_id: request.id };
    }
  );

  app.post(
    "/team/users/:id/disable",
    {
      preHandler: [app.requireDashboardAuth, app.requirePermissions([Permission.TEAM_MANAGE])]
    },
    async (request, reply) => {
      const authUser = request.authUser;
      if (!authUser) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const params = parseWithSchema(userIdParamSchema, request.params);

      const target = await prisma.user.findFirst({
        where: {
          id: params.id,
          tenant_id: authUser.tenant_id
        }
      });

      if (!target) {
        return reply.code(404).send({ error: "User not found" });
      }

      if (target.role === "owner" && authUser.role !== "owner") {
        return reply.code(403).send({ error: "Only owners can disable owner users" });
      }

      if (target.role === "owner" && target.disabled_at === null) {
        const activeOwners = await countActiveOwners(authUser.tenant_id);
        if (activeOwners <= 1) {
          return reply.code(400).send({
            error: "Cannot disable the last active owner",
            code: "LAST_OWNER_PROTECTION"
          });
        }
      }

      if (target.id === authUser.user_id && authUser.role === "owner") {
        return reply.code(400).send({ error: "Owner cannot disable self" });
      }

      const now = new Date();
      const user = await prisma.user.update({
        where: { id: target.id },
        data: {
          disabled_at: now
        },
        select: {
          id: true,
          email: true,
          full_name: true,
          role: true,
          email_verified_at: true,
          created_at: true,
          updated_at: true,
          disabled_at: true
        }
      });

      await prisma.refreshToken.updateMany({
        where: {
          user_id: target.id,
          revoked_at: null
        },
        data: {
          revoked_at: now
        }
      });

      return { user, request_id: request.id };
    }
  );
};

export default teamRoutes;
