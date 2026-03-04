import type { FastifyReply } from "fastify";
import type { User, UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { config } from "../config.js";
import { parseDurationToMs } from "../utils/duration.js";
import { randomOpaqueToken, sha256 } from "../utils/crypto.js";

const refreshTokenTtlMs = parseDurationToMs(config.REFRESH_TOKEN_TTL);
const emailVerificationTokenTtlMs = 24 * 60 * 60 * 1000;
const passwordResetTokenTtlMs = 2 * 60 * 60 * 1000;

export type AuthUser = {
  id: string;
  tenant_id: string;
  email: string;
  full_name: string;
  role: UserRole;
  email_verified_at: Date | null;
};

export type AuthRequestMetadata = {
  ip?: string | null;
  userAgent?: string | null;
};

export type RefreshRotateResult =
  | {
      status: "success";
      access_token: string;
      refresh_token: string;
      refresh_expires_at: string;
      user: AuthUser;
    }
  | {
      status: "invalid";
    }
  | {
      status: "reuse_detected";
    };

function mapAuthUser(user: Pick<User, "id" | "tenant_id" | "email" | "full_name" | "role" | "email_verified_at">): AuthUser {
  return {
    id: user.id,
    tenant_id: user.tenant_id,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
    email_verified_at: user.email_verified_at
  };
}

async function signAccessToken(reply: FastifyReply, user: AuthUser): Promise<string> {
  return reply.jwtSign(
    {
      user_id: user.id,
      tenant_id: user.tenant_id,
      email: user.email,
      full_name: user.full_name,
      role: user.role
    },
    { expiresIn: config.ACCESS_TOKEN_TTL }
  );
}

async function createRefreshToken(userId: string) {
  const rawToken = randomOpaqueToken(48);
  const tokenHash = sha256(rawToken);
  const expiresAt = new Date(Date.now() + refreshTokenTtlMs);

  await prisma.refreshToken.create({
    data: {
      user_id: userId,
      token_hash: tokenHash,
      expires_at: expiresAt
    }
  });

  return { rawToken, expiresAt };
}

function buildRefreshExpiresAt() {
  return new Date(Date.now() + refreshTokenTtlMs);
}

export async function createAuthSession(reply: FastifyReply, user: AuthUser) {
  const [accessToken, refresh] = await Promise.all([
    signAccessToken(reply, user),
    createRefreshToken(user.id)
  ]);

  return {
    access_token: accessToken,
    refresh_token: refresh.rawToken,
    refresh_expires_at: refresh.expiresAt.toISOString(),
    user
  };
}

export async function revokeRefreshToken(rawToken: string): Promise<number> {
  const tokenHash = sha256(rawToken);
  const result = await prisma.refreshToken.updateMany({
    where: {
      token_hash: tokenHash,
      revoked_at: null,
      expires_at: {
        gt: new Date()
      }
    },
    data: {
      revoked_at: new Date()
    }
  });

  return result.count;
}

export async function rotateRefreshToken(
  reply: FastifyReply,
  rawToken: string,
  metadata?: AuthRequestMetadata
): Promise<RefreshRotateResult> {
  const tokenHash = sha256(rawToken);
  const now = new Date();
  const transactionResult = await prisma.$transaction(async (tx) => {
    const tokenRecord = await tx.refreshToken.findUnique({
      where: {
        token_hash: tokenHash
      },
      include: {
        user: true
      }
    });

    if (!tokenRecord) {
      return { status: "invalid" as const };
    }

    const tokenIsActive = tokenRecord.revoked_at === null && tokenRecord.expires_at > now && tokenRecord.user.disabled_at === null;
    if (!tokenIsActive) {
      await tx.refreshToken.updateMany({
        where: {
          user_id: tokenRecord.user_id,
          revoked_at: null
        },
        data: {
          revoked_at: now
        }
      });

      await tx.securityEvent.create({
        data: {
          tenant_id: tokenRecord.user.tenant_id,
          user_id: tokenRecord.user_id,
          type: "REFRESH_REUSE_DETECTED",
          ip: metadata?.ip ?? null,
          user_agent: metadata?.userAgent ?? null,
          metadata_json: {
            token_id: tokenRecord.id,
            reason: tokenRecord.revoked_at ? "already_revoked" : tokenRecord.expires_at <= now ? "expired" : "user_disabled"
          }
        }
      });

      return { status: "reuse_detected" as const };
    }

    // Conditional revoke protects against concurrent refresh races.
    const revokeOldResult = await tx.refreshToken.updateMany({
      where: {
        id: tokenRecord.id,
        revoked_at: null,
        expires_at: {
          gt: now
        }
      },
      data: {
        revoked_at: now
      }
    });

    if (revokeOldResult.count !== 1) {
      await tx.refreshToken.updateMany({
        where: {
          user_id: tokenRecord.user_id,
          revoked_at: null
        },
        data: {
          revoked_at: now
        }
      });

      await tx.securityEvent.create({
        data: {
          tenant_id: tokenRecord.user.tenant_id,
          user_id: tokenRecord.user_id,
          type: "REFRESH_REUSE_DETECTED",
          ip: metadata?.ip ?? null,
          user_agent: metadata?.userAgent ?? null,
          metadata_json: {
            token_id: tokenRecord.id,
            reason: "concurrent_refresh_race"
          }
        }
      });

      return { status: "reuse_detected" as const };
    }

    const nextRawToken = randomOpaqueToken(48);
    const nextTokenHash = sha256(nextRawToken);
    const nextExpiresAt = buildRefreshExpiresAt();

    await tx.refreshToken.create({
      data: {
        user_id: tokenRecord.user_id,
        token_hash: nextTokenHash,
        expires_at: nextExpiresAt
      }
    });

    return {
      status: "success" as const,
      user: mapAuthUser(tokenRecord.user),
      nextRawToken,
      nextExpiresAt
    };
  });

  if (transactionResult.status === "invalid") {
    return transactionResult;
  }

  if (transactionResult.status === "reuse_detected") {
    return transactionResult;
  }

  const accessToken = await signAccessToken(reply, transactionResult.user);
  return {
    status: "success",
    access_token: accessToken,
    refresh_token: transactionResult.nextRawToken,
    refresh_expires_at: transactionResult.nextExpiresAt.toISOString(),
    user: transactionResult.user
  };
}

export async function revokeAllRefreshTokensForUser(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: {
      user_id: userId,
      revoked_at: null
    },
    data: {
      revoked_at: new Date()
    }
  });
}

export async function issueEmailVerificationToken(userId: string) {
  const rawToken = randomOpaqueToken(48);
  const tokenHash = sha256(rawToken);
  const expiresAt = new Date(Date.now() + emailVerificationTokenTtlMs);

  await prisma.emailVerificationToken.create({
    data: {
      user_id: userId,
      token_hash: tokenHash,
      expires_at: expiresAt
    }
  });

  return { rawToken, expiresAt };
}

export async function consumeEmailVerificationToken(rawToken: string) {
  const tokenHash = sha256(rawToken);
  const now = new Date();

  const token = await prisma.emailVerificationToken.findFirst({
    where: {
      token_hash: tokenHash,
      used_at: null,
      expires_at: { gt: now }
    }
  });

  if (!token) {
    return null;
  }

  await prisma.$transaction([
    prisma.emailVerificationToken.update({
      where: { id: token.id },
      data: { used_at: now }
    }),
    prisma.user.update({
      where: { id: token.user_id },
      data: { email_verified_at: now }
    })
  ]);

  return token.user_id;
}

export async function issuePasswordResetToken(userId: string) {
  const rawToken = randomOpaqueToken(48);
  const tokenHash = sha256(rawToken);
  const expiresAt = new Date(Date.now() + passwordResetTokenTtlMs);

  await prisma.passwordResetToken.create({
    data: {
      user_id: userId,
      token_hash: tokenHash,
      expires_at: expiresAt
    }
  });

  return { rawToken, expiresAt };
}

export async function consumePasswordResetToken(rawToken: string, nextPasswordHash: string) {
  const tokenHash = sha256(rawToken);
  const now = new Date();

  const token = await prisma.passwordResetToken.findFirst({
    where: {
      token_hash: tokenHash,
      used_at: null,
      expires_at: { gt: now }
    }
  });

  if (!token) {
    return null;
  }

  await prisma.$transaction([
    prisma.passwordResetToken.update({
      where: { id: token.id },
      data: { used_at: now }
    }),
    prisma.user.update({
      where: { id: token.user_id },
      data: {
        password_hash: nextPasswordHash,
        disabled_at: null
      }
    }),
    prisma.refreshToken.updateMany({
      where: {
        user_id: token.user_id,
        revoked_at: null
      },
      data: {
        revoked_at: now
      }
    })
  ]);

  return token.user_id;
}

export function asAuthUser(user: Pick<User, "id" | "tenant_id" | "email" | "full_name" | "role" | "email_verified_at">): AuthUser {
  return mapAuthUser(user);
}
