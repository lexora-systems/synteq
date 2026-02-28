import type { FastifyInstance } from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyJwt from "@fastify/jwt";
import { config } from "../config.js";
import { hashApiKey, hmacSha256, secureCompareHex } from "../utils/crypto.js";
import { prisma } from "../lib/prisma.js";
import { TtlCache } from "../utils/ttl-cache.js";

const replayGuard = new TtlCache<boolean>(100_000);

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
      const user = request.user as { email: string; tenant_id: string; role: string };
      request.authUser = user;
    } catch {
      reply.code(401).send({ error: "Unauthorized" });
    }
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
    if (!config.INGEST_HMAC_REQUIRED) {
      return;
    }

    if (!config.INGEST_HMAC_SECRET) {
      reply.code(500).send({ error: "INGEST_HMAC_SECRET is required when INGEST_HMAC_REQUIRED=true" });
      return;
    }

    const signatureHeader = request.headers["x-synteq-signature"];
    const timestampHeader = request.headers["x-synteq-timestamp"];
    const signatureRaw = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    const timestampRaw = Array.isArray(timestampHeader) ? timestampHeader[0] : timestampHeader;

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

    const replayKey = `${request.tenantId ?? "unknown"}:${timestampSec}:${signatureRaw}`;
    if (replayGuard.has(replayKey)) {
      reply.code(409).send({ error: "Replay detected" });
      return;
    }

    const rawBody = request.rawBody ?? JSON.stringify(request.body ?? {});
    const expectedSignature = hmacSha256(config.INGEST_HMAC_SECRET, `${timestampSec}.${rawBody}`);
    const actualSignature = signatureRaw.startsWith("sha256=") ? signatureRaw.slice("sha256=".length) : signatureRaw;

    if (!/^[A-Fa-f0-9]+$/.test(actualSignature) || !secureCompareHex(expectedSignature, actualSignature)) {
      reply.code(401).send({ error: "Invalid HMAC signature" });
      return;
    }

    replayGuard.set(replayKey, true, config.INGEST_SIGNATURE_MAX_SKEW_SEC);
  });
}
