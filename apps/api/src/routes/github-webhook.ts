import type { FastifyPluginAsync } from "fastify";
import { ingestOperationalEventsRequestSchema } from "@synteq/shared";
import { config } from "../config.js";
import { runtimeMetrics } from "../lib/runtime-metrics.js";
import { prisma } from "../lib/prisma.js";
import { redisKey, redisSetNx } from "../lib/redis.js";
import { consumeRateLimit } from "../services/rate-limit-service.js";
import {
  extractGitHubRepositoryFullName,
  mapGitHubWebhookToOperationalEvents
} from "../services/github-actions-adapter-service.js";
import { ingestOperationalEvents } from "../services/operational-event-ingestion-service.js";
import { hmacSha256, secureCompareHex } from "../utils/crypto.js";
import { parseWithSchema } from "../utils/validation.js";

const GITHUB_DELIVERY_DEDUPE_TTL_SEC = 24 * 60 * 60;

type GitHubIntegrationLookup = {
  id: string;
  tenant_id: string;
  webhook_secret: string;
  repository_full_name: string | null;
};

function readHeader(headers: Record<string, unknown>, key: string): string | undefined {
  const value = headers[key.toLowerCase()];
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }

  return undefined;
}

function verifyGitHubSignature(input: {
  signatureHeader: string | undefined;
  secret: string;
  rawBody: string;
}) {
  if (!input.signatureHeader) {
    return false;
  }

  if (!input.signatureHeader.startsWith("sha256=")) {
    return false;
  }

  const actual = input.signatureHeader.slice("sha256=".length);
  if (!/^[A-Fa-f0-9]{64}$/.test(actual)) {
    return false;
  }

  const expected = hmacSha256(input.secret, input.rawBody);
  return secureCompareHex(expected, actual);
}

function repositoryMatchesScope(input: {
  integrationRepositoryFullName: string | null;
  payloadRepositoryFullName: string | null;
}) {
  if (!input.integrationRepositoryFullName || !input.payloadRepositoryFullName) {
    return true;
  }

  return input.integrationRepositoryFullName.toLowerCase() === input.payloadRepositoryFullName.toLowerCase();
}

async function resolveGitHubIntegrationForWebhook(input: {
  hookId: string;
  signatureHeader: string;
  rawBody: string;
  payloadRepositoryFullName: string | null;
}): Promise<{ integration: GitHubIntegrationLookup | null; reason: "resolved" | "bad_signature" | "ambiguous" | "not_found" }> {
  const directMatches = await prisma.gitHubIntegration.findMany({
    where: {
      webhook_id: input.hookId,
      is_active: true
    },
    select: {
      id: true,
      tenant_id: true,
      webhook_secret: true,
      repository_full_name: true
    }
  });

  if (directMatches.length > 0) {
    const verifiedDirect = directMatches.find((candidate) =>
      verifyGitHubSignature({
        signatureHeader: input.signatureHeader,
        secret: candidate.webhook_secret,
        rawBody: input.rawBody
      })
    );

    return {
      integration: verifiedDirect ?? null,
      reason: verifiedDirect ? "resolved" : "bad_signature"
    };
  }

  const activeIntegrations = await prisma.gitHubIntegration.findMany({
    where: {
      is_active: true
    },
    select: {
      id: true,
      tenant_id: true,
      webhook_secret: true,
      repository_full_name: true
    }
  });

  const verifiedMatches = activeIntegrations.filter(
    (candidate) =>
      verifyGitHubSignature({
        signatureHeader: input.signatureHeader,
        secret: candidate.webhook_secret,
        rawBody: input.rawBody
      }) &&
      repositoryMatchesScope({
        integrationRepositoryFullName: candidate.repository_full_name,
        payloadRepositoryFullName: input.payloadRepositoryFullName
      })
  );

  if (verifiedMatches.length === 1) {
    return {
      integration: verifiedMatches[0],
      reason: "resolved"
    };
  }

  if (verifiedMatches.length > 1) {
    return {
      integration: null,
      reason: "ambiguous"
    };
  }

  return {
    integration: null,
    reason: "not_found"
  };
}

const githubWebhookRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/integrations/github/webhook",
    {
      config: {
        rawBody: true
      }
    },
    async (request, reply) => {
      const rawBodyInput = request.rawBody ?? JSON.stringify(request.body ?? {});
      const rawBody = typeof rawBodyInput === "string" ? rawBodyInput : rawBodyInput.toString("utf8");
      if (Buffer.byteLength(rawBody, "utf8") > config.MAX_INGEST_BODY_BYTES) {
        runtimeMetrics.increment("github_webhook_payload_too_large_total");
        return reply.code(413).send({ error: "Payload too large" });
      }

      const hookId = readHeader(request.headers as Record<string, unknown>, "x-github-hook-id");
      const eventType = readHeader(request.headers as Record<string, unknown>, "x-github-event");
      const deliveryId = readHeader(request.headers as Record<string, unknown>, "x-github-delivery");
      const signature = readHeader(request.headers as Record<string, unknown>, "x-hub-signature-256");
      const repositoryFullName = extractGitHubRepositoryFullName(request.body);
      if (!hookId || !eventType || !signature) {
        runtimeMetrics.increment("github_webhook_rejected_missing_headers_total");
        return reply.code(401).send({ error: "Missing required GitHub webhook headers" });
      }

      const rate = await consumeRateLimit({
        scope: "github_webhook",
        key: `hook:${hookId}`,
        max: config.INGEST_RATE_LIMIT_PER_MIN,
        windowSec: 60
      });
      if (!rate.allowed) {
        runtimeMetrics.increment("github_webhook_rate_limited_total");
        reply.header("Retry-After", String(rate.retryAfterSec));
        return reply.code(429).send({
          error: "Rate limit exceeded",
          code: "INGEST_RATE_LIMITED"
        });
      }

      const integrationResolution = await resolveGitHubIntegrationForWebhook({
        hookId,
        signatureHeader: signature,
        rawBody,
        payloadRepositoryFullName: repositoryFullName
      });
      const integration = integrationResolution.integration;
      if (!integration) {
        if (integrationResolution.reason === "bad_signature") {
          runtimeMetrics.increment("github_webhook_rejected_bad_signature_total");
          return reply.code(401).send({ error: "Invalid GitHub webhook signature" });
        }
        if (integrationResolution.reason === "ambiguous") {
          runtimeMetrics.increment("github_webhook_rejected_ambiguous_identity_total");
          return reply.code(401).send({ error: "Invalid GitHub webhook integration" });
        }
        runtimeMetrics.increment("github_webhook_rejected_unknown_hook_total");
        return reply.code(401).send({ error: "Invalid GitHub webhook integration" });
      }

      if (deliveryId) {
        const dedupeKey = redisKey("github", "delivery", integration.id, deliveryId);
        const firstSeen = await redisSetNx(dedupeKey, "1", GITHUB_DELIVERY_DEDUPE_TTL_SEC);
        if (!firstSeen) {
          runtimeMetrics.increment("github_webhook_duplicate_total");
          return {
            ok: true,
            processed: false,
            duplicate: true,
            request_id: request.id
          };
        }
      }

      if (integration.repository_full_name && !repositoryFullName) {
        runtimeMetrics.increment("github_webhook_rejected_repository_missing_total");
        return reply.code(400).send({ error: "Repository context missing from webhook payload" });
      }
      if (
        integration.repository_full_name &&
        repositoryFullName &&
        integration.repository_full_name.toLowerCase() !== repositoryFullName.toLowerCase()
      ) {
        runtimeMetrics.increment("github_webhook_rejected_repository_mismatch_total");
        return reply.code(403).send({ error: "Repository does not match integration scope" });
      }

      const mapped = mapGitHubWebhookToOperationalEvents({
        eventType,
        payload: request.body
      });

      if (!mapped.supported || mapped.events.length === 0) {
        runtimeMetrics.increment("github_webhook_ignored_total");
        return reply.code(202).send({
          ok: true,
          processed: false,
          reason: mapped.reason ?? "ignored",
          request_id: request.id
        });
      }

      const normalized = parseWithSchema(ingestOperationalEventsRequestSchema, {
        events: mapped.events
      });
      const idempotencyHints: Array<{ namespace: string; upstreamKey: string } | undefined> = [];
      for (let index = 0; index < normalized.events.length; index += 1) {
        idempotencyHints.push(
          deliveryId
            ? {
                namespace: "github_delivery",
                upstreamKey: `${integration.id}:${deliveryId}:${index}`
              }
            : undefined
        );
      }

      const ingested = await ingestOperationalEvents(normalized, {
        tenantId: integration.tenant_id,
        requestId: request.id,
        idempotencyHints,
        sourceOwner: {
          kind: "github_integration",
          integrationId: integration.id
        }
      });
      runtimeMetrics.increment("github_webhook_ingested_total", ingested.persisted);

      prisma.gitHubIntegration
        .update({
          where: { id: integration.id },
          data: {
            last_seen_at: new Date(),
            last_delivery_id: deliveryId ?? null
          }
        })
        .catch(() => {
          app.log.warn({ integration_id: integration.id }, "Failed to update github integration last seen metadata");
        });

      return {
        ok: true,
        processed: ingested.ingested > 0,
        duplicate: ingested.ingested === 0 && ingested.duplicates > 0 && ingested.failed === 0,
        accepted: ingested.accepted,
        ingested: ingested.ingested,
        duplicates: ingested.duplicates,
        skipped: ingested.skipped,
        failed: ingested.failed,
        persisted: ingested.persisted,
        analysis_handoff: ingested.analysis_handoff,
        request_id: request.id
      };
    }
  );
};

export default githubWebhookRoutes;
