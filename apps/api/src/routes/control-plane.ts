import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type { Prisma } from "@prisma/client";
import {
  alertChannelCreateSchema,
  alertChannelUpdateSchema,
  alertPolicyCreateSchema,
  alertPolicyUpdateSchema,
  apiKeyCreateSchema,
  githubIntegrationCreateSchema
} from "@synteq/shared";
import { z } from "zod";
import { parseWithSchema } from "../utils/validation.js";
import { prisma } from "../lib/prisma.js";
import { hashApiKey, randomApiKey, randomOpaqueToken } from "../utils/crypto.js";
import { config } from "../config.js";
import { synteqDataContract } from "../lib/data-contract.js";
import { Permission } from "../auth/permissions.js";
import {
  replyIfEntitlementError,
  requireFeature,
  requireSourceCapacity,
  resolveTenantAccess
} from "../services/entitlement-guard-service.js";
import {
  countCapacitySourcesForTenant,
  listCanonicalSourcesForTenant,
  summarizeCanonicalSources
} from "../services/source-service.js";

const idParamSchema = z.object({
  id: z.string().min(1)
});

const apiKeyListQuerySchema = z.object({
  include_revoked: z.coerce.boolean().optional().default(false)
});

const slackChannelConfigSchema = z.object({
  webhook_url: z.string().url()
});

const webhookChannelConfigSchema = z.object({
  url: z.string().url()
});

const emailChannelConfigSchema = z.object({
  email: z.string().email()
});

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function maskApiKeyPreview(hash: string) {
  return `synteq_****${hash.slice(-6)}`;
}

function maskUrl(value: string) {
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname.slice(0, 16)}...`;
  } catch {
    return "configured";
  }
}

function normalizeChannelConfig(input: {
  type: "slack" | "webhook" | "email";
  config: unknown;
}): Prisma.InputJsonValue {
  if (input.type === "slack") {
    return slackChannelConfigSchema.parse(input.config) as Prisma.InputJsonObject;
  }

  if (input.type === "webhook") {
    return webhookChannelConfigSchema.parse(input.config) as Prisma.InputJsonObject;
  }

  return emailChannelConfigSchema.parse(input.config) as Prisma.InputJsonObject;
}

function channelConfigPreview(input: {
  type: "slack" | "webhook" | "email";
  config: unknown;
}): Record<string, unknown> {
  const configJson = asObject(input.config);

  if (input.type === "email") {
    return {
      email: typeof configJson.email === "string" ? configJson.email : "configured"
    };
  }

  if (input.type === "slack") {
    return {
      webhook_url: typeof configJson.webhook_url === "string" ? maskUrl(configJson.webhook_url) : "configured"
    };
  }

  return {
    url: typeof configJson.url === "string" ? maskUrl(configJson.url) : "configured"
  };
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function deriveWebhookUrl(request: FastifyRequest) {
  const forwardedProto = firstHeaderValue(request.headers["x-forwarded-proto"]);
  const forwardedHost = firstHeaderValue(request.headers["x-forwarded-host"]);
  const host = forwardedHost ?? firstHeaderValue(request.headers.host) ?? "localhost:8080";
  const proto = forwardedProto ?? request.protocol ?? "https";
  return `${proto}://${host}/v1/integrations/github/webhook`;
}

async function assertAlertsFeatureOrReply(request: FastifyRequest, reply: { code: (code: number) => { send: (payload: unknown) => unknown } }) {
  const tenantId = request.authUser?.tenant_id;
  if (!tenantId) {
    reply.code(401).send({ error: "Unauthorized" });
    return false;
  }

  try {
    const access = await resolveTenantAccess({
      tenantId
    });
    requireFeature(access, "alerts");
    return true;
  } catch (error) {
    if (replyIfEntitlementError(reply as never, request.id, error)) {
      return false;
    }
    throw error;
  }
}

async function assertWorkflowBelongsToTenant(tenantId: string, workflowId?: string | null) {
  if (!workflowId) {
    return;
  }

  const workflow = await prisma.workflow.findFirst({
    where: {
      id: workflowId,
      tenant_id: tenantId
    },
    select: {
      id: true
    }
  });

  if (!workflow) {
    const error = new Error("Workflow not found for tenant");
    error.name = "NotFoundError";
    throw error;
  }
}

async function assertChannelsBelongToTenant(tenantId: string, channelIds: string[]) {
  if (channelIds.length === 0) {
    return;
  }

  const channels = await prisma.alertChannel.findMany({
    where: {
      tenant_id: tenantId,
      id: {
        in: channelIds
      }
    },
    select: {
      id: true
    }
  });

  if (channels.length !== new Set(channelIds).size) {
    const error = new Error("One or more channels were not found for this tenant");
    error.name = "NotFoundError";
    throw error;
  }
}

const controlPlaneRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/control-plane/api-keys",
    {
      preHandler: [app.requireDashboardAuth, app.requirePermissions([Permission.SETTINGS_MANAGE])]
    },
    async (request, reply) => {
      const tenantId = request.authUser?.tenant_id;
      if (!tenantId) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const query = parseWithSchema(apiKeyListQuerySchema, request.query);

      const keys = await prisma.apiKey.findMany({
        where: {
          tenant_id: tenantId,
          ...(query.include_revoked ? {} : { revoked_at: null })
        },
        orderBy: {
          created_at: "desc"
        },
        select: {
          id: true,
          name: true,
          key_hash: true,
          created_at: true,
          last_used_at: true,
          revoked_at: true
        }
      });

      return {
        api_keys: keys.map((key) => ({
          id: key.id,
          name: key.name,
          key_preview: maskApiKeyPreview(key.key_hash),
          created_at: key.created_at,
          last_used_at: key.last_used_at,
          revoked_at: key.revoked_at
        })),
        request_id: request.id
      };
    }
  );

  app.post(
    "/control-plane/api-keys",
    {
      preHandler: [app.requireDashboardAuth, app.requirePermissions([Permission.SETTINGS_MANAGE])]
    },
    async (request, reply) => {
      const tenantId = request.authUser?.tenant_id;
      if (!tenantId) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const body = parseWithSchema(apiKeyCreateSchema, request.body);
      const rawKey = randomApiKey();
      const keyHash = hashApiKey(rawKey, config.SYNTEQ_API_KEY_SALT);

      const apiKey = await prisma.apiKey.create({
        data: {
          tenant_id: tenantId,
          name: body.name,
          key_hash: keyHash
        },
        select: {
          id: true,
          name: true,
          created_at: true,
          last_used_at: true,
          revoked_at: true,
          key_hash: true
        }
      });

      return reply.code(201).send({
        api_key: {
          id: apiKey.id,
          name: apiKey.name,
          key_preview: maskApiKeyPreview(apiKey.key_hash),
          created_at: apiKey.created_at,
          last_used_at: apiKey.last_used_at,
          revoked_at: apiKey.revoked_at
        },
        secret: rawKey,
        request_id: request.id
      });
    }
  );

  app.post(
    "/control-plane/api-keys/:id/revoke",
    {
      preHandler: [app.requireDashboardAuth, app.requirePermissions([Permission.SETTINGS_MANAGE])]
    },
    async (request, reply) => {
      const tenantId = request.authUser?.tenant_id;
      if (!tenantId) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const params = parseWithSchema(idParamSchema, request.params);

      const existing = await prisma.apiKey.findFirst({
        where: {
          id: params.id,
          tenant_id: tenantId
        },
        select: {
          id: true,
          revoked_at: true
        }
      });

      if (!existing) {
        return reply.code(404).send({ error: "API key not found" });
      }

      if (!existing.revoked_at) {
        await prisma.apiKey.update({
          where: { id: existing.id },
          data: {
            revoked_at: new Date()
          }
        });
      }

      return {
        ok: true,
        revoked: true,
        api_key_id: existing.id,
        request_id: request.id
      };
    }
  );

  app.post(
    "/control-plane/api-keys/:id/rotate",
    {
      preHandler: [app.requireDashboardAuth, app.requirePermissions([Permission.SETTINGS_MANAGE])]
    },
    async (request, reply) => {
      const tenantId = request.authUser?.tenant_id;
      if (!tenantId) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const params = parseWithSchema(idParamSchema, request.params);

      const existing = await prisma.apiKey.findFirst({
        where: {
          id: params.id,
          tenant_id: tenantId
        },
        select: {
          id: true,
          name: true,
          revoked_at: true
        }
      });

      if (!existing) {
        return reply.code(404).send({ error: "API key not found" });
      }

      const now = new Date();
      const rawKey = randomApiKey();
      const keyHash = hashApiKey(rawKey, config.SYNTEQ_API_KEY_SALT);

      const rotated = await prisma.$transaction(async (tx) => {
        if (!existing.revoked_at) {
          await tx.apiKey.update({
            where: {
              id: existing.id
            },
            data: {
              revoked_at: now
            }
          });
        }

        return tx.apiKey.create({
          data: {
            tenant_id: tenantId,
            name: existing.name,
            key_hash: keyHash
          },
          select: {
            id: true,
            name: true,
            key_hash: true,
            created_at: true,
            last_used_at: true,
            revoked_at: true
          }
        });
      });

      return {
        rotated_from_api_key_id: existing.id,
        api_key: {
          id: rotated.id,
          name: rotated.name,
          key_preview: maskApiKeyPreview(rotated.key_hash),
          created_at: rotated.created_at,
          last_used_at: rotated.last_used_at,
          revoked_at: rotated.revoked_at
        },
        secret: rawKey,
        request_id: request.id
      };
    }
  );

  app.get(
    "/control-plane/github-integrations",
    {
      preHandler: [app.requireDashboardAuth, app.requirePermissions([Permission.SETTINGS_MANAGE])]
    },
    async (request, reply) => {
      const tenantId = request.authUser?.tenant_id;
      if (!tenantId) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const integrations = await prisma.gitHubIntegration.findMany({
        where: {
          tenant_id: tenantId
        },
        orderBy: {
          created_at: "desc"
        },
        select: {
          id: true,
          webhook_id: true,
          repository_full_name: true,
          is_active: true,
          last_delivery_id: true,
          last_seen_at: true,
          created_at: true,
          updated_at: true
        }
      });

      return {
        webhook_url: deriveWebhookUrl(request),
        integrations,
        request_id: request.id
      };
    }
  );

  app.post(
    "/control-plane/github-integrations",
    {
      preHandler: [app.requireDashboardAuth, app.requirePermissions([Permission.SETTINGS_MANAGE])]
    },
    async (request, reply) => {
      const tenantId = request.authUser?.tenant_id;
      if (!tenantId) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const body = parseWithSchema(githubIntegrationCreateSchema, request.body);

      try {
        const access = await resolveTenantAccess({
          tenantId
        });
        const currentActiveSources = await countCapacitySourcesForTenant({
          tenantId
        });
        requireSourceCapacity({
          access,
          currentActiveSources
        });
      } catch (error) {
        if (replyIfEntitlementError(reply, request.id, error)) {
          return;
        }
        throw error;
      }

      let integration:
        | {
            id: string;
            webhook_id: string;
            repository_full_name: string | null;
            is_active: boolean;
            last_delivery_id: string | null;
            last_seen_at: Date | null;
            created_at: Date;
            updated_at: Date;
          }
        | null = null;
      let webhookSecret = "";
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const webhookId = `gh_${randomOpaqueToken(18)}`;
        webhookSecret = randomOpaqueToken(36);
        try {
          integration = await prisma.gitHubIntegration.create({
            data: {
              tenant_id: tenantId,
              webhook_id: webhookId,
              webhook_secret: webhookSecret,
              repository_full_name: body.repository_full_name ?? null,
              is_active: true
            },
            select: {
              id: true,
              webhook_id: true,
              repository_full_name: true,
              is_active: true,
              last_delivery_id: true,
              last_seen_at: true,
              created_at: true,
              updated_at: true
            }
          });
          break;
        } catch (error) {
          const prismaError = error as { code?: string };
          if (prismaError.code !== "P2002") {
            throw error;
          }
        }
      }

      if (!integration) {
        return reply.code(500).send({
          error: "Unable to allocate a unique webhook id. Please retry."
        });
      }

      return reply.code(201).send({
        webhook_url: deriveWebhookUrl(request),
        integration,
        webhook_secret: webhookSecret,
        request_id: request.id
      });
    }
  );

  app.post(
    "/control-plane/github-integrations/:id/deactivate",
    {
      preHandler: [app.requireDashboardAuth, app.requirePermissions([Permission.SETTINGS_MANAGE])]
    },
    async (request, reply) => {
      const tenantId = request.authUser?.tenant_id;
      if (!tenantId) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const params = parseWithSchema(idParamSchema, request.params);

      const existing = await prisma.gitHubIntegration.findFirst({
        where: {
          id: params.id,
          tenant_id: tenantId
        },
        select: {
          id: true
        }
      });

      if (!existing) {
        return reply.code(404).send({ error: "GitHub integration not found" });
      }

      const updated = await prisma.gitHubIntegration.update({
        where: {
          id: existing.id
        },
        data: {
          is_active: false
        },
        select: {
          id: true,
          webhook_id: true,
          repository_full_name: true,
          is_active: true,
          last_delivery_id: true,
          last_seen_at: true,
          created_at: true,
          updated_at: true
        }
      });

      return {
        integration: updated,
        request_id: request.id
      };
    }
  );

  app.post(
    "/control-plane/github-integrations/:id/rotate-secret",
    {
      preHandler: [app.requireDashboardAuth, app.requirePermissions([Permission.SETTINGS_MANAGE])]
    },
    async (request, reply) => {
      const tenantId = request.authUser?.tenant_id;
      if (!tenantId) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const params = parseWithSchema(idParamSchema, request.params);

      const existing = await prisma.gitHubIntegration.findFirst({
        where: {
          id: params.id,
          tenant_id: tenantId
        },
        select: {
          id: true
        }
      });

      if (!existing) {
        return reply.code(404).send({ error: "GitHub integration not found" });
      }

      const nextSecret = randomOpaqueToken(36);
      const updated = await prisma.gitHubIntegration.update({
        where: {
          id: existing.id
        },
        data: {
          webhook_secret: nextSecret
        },
        select: {
          id: true,
          webhook_id: true,
          repository_full_name: true,
          is_active: true,
          last_delivery_id: true,
          last_seen_at: true,
          created_at: true,
          updated_at: true
        }
      });

      return {
        webhook_url: deriveWebhookUrl(request),
        integration: updated,
        webhook_secret: nextSecret,
        request_id: request.id
      };
    }
  );

  app.get(
    "/control-plane/alert-channels",
    {
      preHandler: [app.requireDashboardAuth, app.requirePermissions([Permission.POLICIES_READ])]
    },
    async (request, reply) => {
      const tenantId = request.authUser?.tenant_id;
      if (!tenantId) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const channels = await prisma.alertChannel.findMany({
        where: {
          tenant_id: tenantId
        },
        orderBy: {
          created_at: "desc"
        },
        select: {
          id: true,
          name: true,
          type: true,
          config_json: true,
          is_enabled: true,
          created_at: true
        }
      });

      return {
        channels: channels.map((channel) => ({
          id: channel.id,
          name: channel.name,
          type: channel.type,
          is_enabled: channel.is_enabled,
          created_at: channel.created_at,
          config_preview: channelConfigPreview({
            type: channel.type,
            config: channel.config_json
          })
        })),
        request_id: request.id
      };
    }
  );

  app.post(
    "/control-plane/alert-channels",
    {
      preHandler: [app.requireDashboardAuth, app.requirePermissions([Permission.SETTINGS_MANAGE])]
    },
    async (request, reply) => {
      const tenantId = request.authUser?.tenant_id;
      if (!tenantId) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const entitled = await assertAlertsFeatureOrReply(request, reply);
      if (!entitled) {
        return;
      }
      const body = parseWithSchema(alertChannelCreateSchema, request.body);
      const configJson = normalizeChannelConfig({
        type: body.type,
        config: body.config
      });

      const channel = await prisma.alertChannel.create({
        data: {
          tenant_id: tenantId,
          name: body.name,
          type: body.type,
          config_json: configJson,
          is_enabled: true
        },
        select: {
          id: true,
          name: true,
          type: true,
          is_enabled: true,
          created_at: true,
          config_json: true
        }
      });

      return reply.code(201).send({
        channel: {
          id: channel.id,
          name: channel.name,
          type: channel.type,
          is_enabled: channel.is_enabled,
          created_at: channel.created_at,
          config_preview: channelConfigPreview({
            type: channel.type,
            config: channel.config_json
          })
        },
        request_id: request.id
      });
    }
  );

  app.patch(
    "/control-plane/alert-channels/:id",
    {
      preHandler: [app.requireDashboardAuth, app.requirePermissions([Permission.SETTINGS_MANAGE])]
    },
    async (request, reply) => {
      const tenantId = request.authUser?.tenant_id;
      if (!tenantId) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const entitled = await assertAlertsFeatureOrReply(request, reply);
      if (!entitled) {
        return;
      }
      const params = parseWithSchema(idParamSchema, request.params);
      const body = parseWithSchema(alertChannelUpdateSchema, request.body);

      const existing = await prisma.alertChannel.findFirst({
        where: {
          id: params.id,
          tenant_id: tenantId
        },
        select: {
          id: true,
          type: true
        }
      });

      if (!existing) {
        return reply.code(404).send({ error: "Alert channel not found" });
      }

      const nextConfig =
        body.config !== undefined
          ? normalizeChannelConfig({
              type: existing.type,
              config: body.config
            })
          : undefined;

      const channel = await prisma.alertChannel.update({
        where: {
          id: existing.id
        },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.is_enabled !== undefined ? { is_enabled: body.is_enabled } : {}),
          ...(nextConfig !== undefined ? { config_json: nextConfig } : {})
        },
        select: {
          id: true,
          name: true,
          type: true,
          is_enabled: true,
          created_at: true,
          config_json: true
        }
      });

      return {
        channel: {
          id: channel.id,
          name: channel.name,
          type: channel.type,
          is_enabled: channel.is_enabled,
          created_at: channel.created_at,
          config_preview: channelConfigPreview({
            type: channel.type,
            config: channel.config_json
          })
        },
        request_id: request.id
      };
    }
  );

  app.delete(
    "/control-plane/alert-channels/:id",
    {
      preHandler: [app.requireDashboardAuth, app.requirePermissions([Permission.SETTINGS_MANAGE])]
    },
    async (request, reply) => {
      const tenantId = request.authUser?.tenant_id;
      if (!tenantId) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const entitled = await assertAlertsFeatureOrReply(request, reply);
      if (!entitled) {
        return;
      }
      const params = parseWithSchema(idParamSchema, request.params);

      const existing = await prisma.alertChannel.findFirst({
        where: {
          id: params.id,
          tenant_id: tenantId
        },
        select: {
          id: true
        }
      });

      if (!existing) {
        return reply.code(404).send({ error: "Alert channel not found" });
      }

      await prisma.alertChannel.update({
        where: {
          id: existing.id
        },
        data: {
          is_enabled: false
        }
      });

      return {
        ok: true,
        channel_id: existing.id,
        request_id: request.id
      };
    }
  );

  app.get(
    "/control-plane/alert-policies",
    {
      preHandler: [app.requireDashboardAuth, app.requirePermissions([Permission.POLICIES_READ])]
    },
    async (request, reply) => {
      const tenantId = request.authUser?.tenant_id;
      if (!tenantId) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const policies = await prisma.alertPolicy.findMany({
        where: {
          tenant_id: tenantId
        },
        include: {
          channels: {
            include: {
              channel: {
                select: {
                  id: true,
                  name: true,
                  type: true,
                  is_enabled: true
                }
              }
            }
          }
        },
        orderBy: {
          created_at: "desc"
        }
      });

      return {
        policies: policies.map((policy) => ({
          id: policy.id,
          name: policy.name,
          metric: policy.metric,
          window_sec: policy.window_sec,
          threshold: policy.threshold,
          comparator: policy.comparator,
          min_events: policy.min_events,
          severity: policy.severity,
          is_enabled: policy.is_enabled,
          filter_workflow_id: policy.filter_workflow_id,
          filter_env: policy.filter_env,
          created_at: policy.created_at,
          channels: policy.channels.map((row) => row.channel)
        })),
        request_id: request.id
      };
    }
  );

  app.post(
    "/control-plane/alert-policies",
    {
      preHandler: [app.requireDashboardAuth, app.requirePermissions([Permission.SETTINGS_MANAGE])]
    },
    async (request, reply) => {
      const tenantId = request.authUser?.tenant_id;
      if (!tenantId) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const entitled = await assertAlertsFeatureOrReply(request, reply);
      if (!entitled) {
        return;
      }
      const body = parseWithSchema(alertPolicyCreateSchema, request.body);

      try {
        await assertWorkflowBelongsToTenant(tenantId, body.filter_workflow_id ?? null);
        await assertChannelsBelongToTenant(tenantId, body.channel_ids);
      } catch (error) {
        if (error instanceof Error && error.name === "NotFoundError") {
          return reply.code(404).send({
            error: error.message
          });
        }
        throw error;
      }

      const created = await prisma.$transaction(async (tx) => {
        const policy = await tx.alertPolicy.create({
          data: {
            tenant_id: tenantId,
            name: body.name,
            metric: body.metric,
            window_sec: body.window_sec,
            threshold: body.threshold,
            comparator: body.comparator,
            min_events: body.min_events,
            severity: body.severity,
            is_enabled: body.is_enabled,
            filter_workflow_id: body.filter_workflow_id ?? null,
            filter_env: body.filter_env ?? null
          }
        });

        if (body.channel_ids.length > 0) {
          await tx.alertPolicyChannel.createMany({
            data: body.channel_ids.map((channelId: string) => ({
              policy_id: policy.id,
              channel_id: channelId
            })),
            skipDuplicates: true
          });
        }

        return tx.alertPolicy.findUniqueOrThrow({
          where: {
            id: policy.id
          },
          include: {
            channels: {
              include: {
                channel: {
                  select: {
                    id: true,
                    name: true,
                    type: true,
                    is_enabled: true
                  }
                }
              }
            }
          }
        });
      });

      return reply.code(201).send({
        policy: {
          id: created.id,
          name: created.name,
          metric: created.metric,
          window_sec: created.window_sec,
          threshold: created.threshold,
          comparator: created.comparator,
          min_events: created.min_events,
          severity: created.severity,
          is_enabled: created.is_enabled,
          filter_workflow_id: created.filter_workflow_id,
          filter_env: created.filter_env,
          created_at: created.created_at,
          channels: created.channels.map((row) => row.channel)
        },
        request_id: request.id
      });
    }
  );

  app.patch(
    "/control-plane/alert-policies/:id",
    {
      preHandler: [app.requireDashboardAuth, app.requirePermissions([Permission.SETTINGS_MANAGE])]
    },
    async (request, reply) => {
      const tenantId = request.authUser?.tenant_id;
      if (!tenantId) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const entitled = await assertAlertsFeatureOrReply(request, reply);
      if (!entitled) {
        return;
      }
      const params = parseWithSchema(idParamSchema, request.params);
      const body = parseWithSchema(alertPolicyUpdateSchema, request.body);

      const existing = await prisma.alertPolicy.findFirst({
        where: {
          id: params.id,
          tenant_id: tenantId
        },
        select: {
          id: true
        }
      });

      if (!existing) {
        return reply.code(404).send({ error: "Alert policy not found" });
      }

      try {
        await assertWorkflowBelongsToTenant(tenantId, body.filter_workflow_id ?? null);
        if (body.channel_ids) {
          await assertChannelsBelongToTenant(tenantId, body.channel_ids);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "NotFoundError") {
          return reply.code(404).send({
            error: error.message
          });
        }
        throw error;
      }

      const updated = await prisma.$transaction(async (tx) => {
        await tx.alertPolicy.update({
          where: {
            id: existing.id
          },
          data: {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.metric !== undefined ? { metric: body.metric } : {}),
            ...(body.window_sec !== undefined ? { window_sec: body.window_sec } : {}),
            ...(body.threshold !== undefined ? { threshold: body.threshold } : {}),
            ...(body.comparator !== undefined ? { comparator: body.comparator } : {}),
            ...(body.min_events !== undefined ? { min_events: body.min_events } : {}),
            ...(body.severity !== undefined ? { severity: body.severity } : {}),
            ...(body.is_enabled !== undefined ? { is_enabled: body.is_enabled } : {}),
            ...(body.filter_workflow_id !== undefined ? { filter_workflow_id: body.filter_workflow_id ?? null } : {}),
            ...(body.filter_env !== undefined ? { filter_env: body.filter_env ?? null } : {})
          }
        });

        if (body.channel_ids !== undefined) {
          await tx.alertPolicyChannel.deleteMany({
            where: {
              policy_id: existing.id
            }
          });

          if (body.channel_ids.length > 0) {
            await tx.alertPolicyChannel.createMany({
              data: body.channel_ids.map((channelId: string) => ({
                policy_id: existing.id,
                channel_id: channelId
              })),
              skipDuplicates: true
            });
          }
        }

        return tx.alertPolicy.findUniqueOrThrow({
          where: {
            id: existing.id
          },
          include: {
            channels: {
              include: {
                channel: {
                  select: {
                    id: true,
                    name: true,
                    type: true,
                    is_enabled: true
                  }
                }
              }
            }
          }
        });
      });

      return {
        policy: {
          id: updated.id,
          name: updated.name,
          metric: updated.metric,
          window_sec: updated.window_sec,
          threshold: updated.threshold,
          comparator: updated.comparator,
          min_events: updated.min_events,
          severity: updated.severity,
          is_enabled: updated.is_enabled,
          filter_workflow_id: updated.filter_workflow_id,
          filter_env: updated.filter_env,
          created_at: updated.created_at,
          channels: updated.channels.map((row) => row.channel)
        },
        request_id: request.id
      };
    }
  );

  app.delete(
    "/control-plane/alert-policies/:id",
    {
      preHandler: [app.requireDashboardAuth, app.requirePermissions([Permission.SETTINGS_MANAGE])]
    },
    async (request, reply) => {
      const tenantId = request.authUser?.tenant_id;
      if (!tenantId) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const entitled = await assertAlertsFeatureOrReply(request, reply);
      if (!entitled) {
        return;
      }
      const params = parseWithSchema(idParamSchema, request.params);

      const existing = await prisma.alertPolicy.findFirst({
        where: {
          id: params.id,
          tenant_id: tenantId
        },
        select: {
          id: true
        }
      });

      if (!existing) {
        return reply.code(404).send({ error: "Alert policy not found" });
      }

      await prisma.alertPolicy.delete({
        where: {
          id: existing.id
        }
      });

      return {
        ok: true,
        policy_id: existing.id,
        request_id: request.id
      };
    }
  );

  app.get(
    "/control-plane/sources",
    {
      preHandler: [app.requireDashboardAuth, app.requirePermissions([Permission.DASHBOARD_VIEW])]
    },
    async (request, reply) => {
      const tenantId = request.authUser?.tenant_id;
      if (!tenantId) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const [canonicalSources, enabledChannels] = await Promise.all([
        listCanonicalSourcesForTenant({
          tenantId,
          includeCustomIngestion: true
        }),
        prisma.alertChannel.count({
          where: {
            tenant_id: tenantId,
            is_enabled: true
          }
        })
      ]);

      const summary = summarizeCanonicalSources(canonicalSources);
      const workflowSources = canonicalSources.filter((source) => source.kind === "workflow");
      const githubSources = canonicalSources.filter((source) => source.kind === "github_integration");

      return {
        data_contract: synteqDataContract,
        summary: {
          workflow_sources: summary.workflow_sources,
          github_sources: summary.github_sources,
          ingestion_keys_active: summary.ingestion_keys_active,
          alert_channels_ready: enabledChannels
        },
        sources: [
          ...workflowSources.map((source) => ({
            id: source.id,
            type: "workflow",
            name: source.displayName,
            status: source.status,
            powers: "Execution and heartbeat telemetry",
            details: source.details,
            last_activity_at: source.lastActivityAt,
            connected_at: source.connectedAt
          })),
          ...githubSources.map((source) => ({
            id: source.id,
            type: "github_integration",
            name: source.displayName,
            status: source.status,
            powers: "GitHub Actions operational events",
            details: source.details,
            last_activity_at: source.lastActivityAt,
            connected_at: source.connectedAt
          }))
        ],
        readiness: {
          ingestion_api_keys_configured: summary.ingestion_keys_active > 0,
          alert_dispatch_ready: enabledChannels > 0
        },
        request_id: request.id
      };
    }
  );
};

export default controlPlaneRoutes;
