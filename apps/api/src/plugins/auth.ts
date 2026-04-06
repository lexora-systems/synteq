import type { FastifyInstance } from "fastify";
import type { UserRole } from "@prisma/client";
import fastifyCors from "@fastify/cors";
import fastifyJwt from "@fastify/jwt";
import { config } from "../config.js";
import { hashApiKey, hmacSha256, secureCompareHex } from "../utils/crypto.js";
import { prisma } from "../lib/prisma.js";
import { hasRequiredRole } from "../utils/rbac.js";
import { hasRequiredPermissions, type Permission } from "../auth/permissions.js";
import { redisSetNx, redisKey } from "../lib/redis.js";

let loggedDeferredIngestionSignatureWarning = false;
let loggedEnforcedIngestionSignature = false;

export async function registerAuthAndSecurity(app: FastifyInstance) {
  await app.register(fastifyCors, {
    origin: config.CORS_ORIGIN === "*" ? true : config.CORS_ORIGIN.split(",")
  });

  await app.register(fastifyJwt, {
    secret: config.JWT_SECRET
  });

  app.decorate("requireDashboardAuth", async (request, reply) => {
    try {
      await request.jwtVerify();

      const claims = request.user as {
        user_id?: string;
        email: string;
        tenant_id: string;
      };

      const user = claims.user_id
        ? await prisma.user.findFirst({
            where: {
              id: claims.user_id,
              tenant_id: claims.tenant_id,
              disabled_at: null
            }
          })
        : await prisma.user.findFirst({
            where: {
              email: claims.email,
              tenant_id: claims.tenant_id,
              disabled_at: null
            }
          });

      if (!user) {
        reply.code(401).send({ error: "Unauthorized" });
        return;
      }

      request.authUser = {
        user_id: user.id,
        email: user.email,
        full_name: user.full_name,
        tenant_id: user.tenant_id,
        role: user.role,
        email_verified_at: user.email_verified_at?.toISOString() ?? null
      };
    } catch {
      reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.decorate("requireRoles", (allowedRoles: UserRole[]) => {
    return async (request, reply) => {
      if (!request.authUser) {
        reply.code(401).send({ error: "Unauthorized" });
        return;
      }

      if (!hasRequiredRole(request.authUser.role as UserRole, allowedRoles)) {
        reply.code(403).send({ error: "Forbidden" });
        return;
      }
    };
  });

  app.decorate("requirePermissions", (requiredPermissions: Permission[]) => {
    return async (request, reply) => {
      if (!request.authUser) {
        reply.code(401).send({ error: "Unauthorized" });
        return;
      }

      if (!hasRequiredPermissions(request.authUser.role as UserRole, requiredPermissions)) {
        reply.code(403).send({
          error: "Forbidden",
          code: "FORBIDDEN_PERMISSION"
        });
        return;
      }
    };
  });

  app.decorate("requireIngestionKey", async (request, reply) => {
    const rawHeader = request.headers["x-synteq-key"];
    const rawKey = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

    if (!rawKey) {
      reply.code(401).send({ error: "Missing X-Synteq-Key header" });
      return;
    }

    const keyHash = hashApiKey(rawKey, config.SYNTEQ_API_KEY_SALT);
    const apiKey = await prisma.apiKey.findFirst({
      where: {
        key_hash: keyHash,
        revoked_at: null
      }
    });

    if (!apiKey) {
      reply.code(401).send({ error: "Invalid API key" });
      return;
    }

    request.tenantId = apiKey.tenant_id;
    request.apiKeyId = apiKey.id;

    prisma.apiKey
      .update({
        where: { id: apiKey.id },
        data: { last_used_at: new Date() }
      })
      .catch(() => {
        app.log.warn({ apiKeyId: apiKey.id }, "Failed to update API key last_used_at");
      });
  });

  app.decorate("requireIngestionSignature", async (request, reply) => {
    const signatureHeader = request.headers["x-synteq-signature"];
    const timestampHeader = request.headers["x-synteq-timestamp"];
    const signatureRaw = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    const timestampRaw = Array.isArray(timestampHeader) ? timestampHeader[0] : timestampHeader;

    if (!config.INGEST_HMAC_REQUIRED) {
      if ((!signatureRaw || !timestampRaw) && !loggedDeferredIngestionSignatureWarning) {
        loggedDeferredIngestionSignatureWarning = true;
        request.log.warn({
          event: "hardening_deferred",
          flag: "INGEST_HMAC_REQUIRED",
          path: request.url,
          reason: "missing_ingest_signature_headers"
        });
      }
      return;
    }

    if (!loggedEnforcedIngestionSignature) {
      loggedEnforcedIngestionSignature = true;
      request.log.info({
        event: "hardening_enforced",
        flag: "INGEST_HMAC_REQUIRED",
        path: request.url
      });
    }

    if (!config.INGEST_HMAC_SECRET) {
      reply.code(500).send({ error: "INGEST_HMAC_SECRET is required when INGEST_HMAC_REQUIRED=true" });
      return;
    }

    if (!signatureRaw || !timestampRaw) {
      reply.code(401).send({ error: "Missing X-Synteq-Signature or X-Synteq-Timestamp header" });
      return;
    }

    const timestampSec = Number(timestampRaw);
    if (!Number.isFinite(timestampSec)) {
      reply.code(401).send({ error: "Invalid X-Synteq-Timestamp header" });
      return;
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - timestampSec) > config.INGEST_SIGNATURE_MAX_SKEW_SEC) {
      reply.code(401).send({ error: "Request timestamp outside allowed skew window" });
      return;
    }

    const rawBody = request.rawBody ?? JSON.stringify(request.body ?? {});
    const expectedSignature = hmacSha256(config.INGEST_HMAC_SECRET, `${timestampSec}.${rawBody}`);
    const actualSignature = signatureRaw.startsWith("sha256=") ? signatureRaw.slice("sha256=".length) : signatureRaw;

    if (!/^[A-Fa-f0-9]+$/.test(actualSignature) || !secureCompareHex(expectedSignature, actualSignature)) {
      reply.code(401).send({ error: "Invalid HMAC signature" });
      return;
    }

    const replayKey = redisKey("ingest", "replay", request.tenantId ?? "unknown", timestampSec, signatureRaw);
    const accepted = await redisSetNx(replayKey, "1", config.INGEST_SIGNATURE_MAX_SKEW_SEC);
    if (!accepted) {
      reply.code(409).send({ error: "Replay detected" });
      return;
    }

  });
}
