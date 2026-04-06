import type { Prisma } from "@prisma/client";
import { config } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { sendIncidentAlert } from "./email-service.js";
import { hasFeature, resolveTenantAccess, type ResolvedTenantAccess } from "./entitlement-guard-service.js";

type DispatchResult = {
  channel_id: string;
  type: string;
  ok: boolean;
  status?: number;
  error?: string;
};

type PendingPayload = {
  retry_attempt?: number;
  retry_not_before?: string;
  [key: string]: unknown;
};

const dispatchWorkerId = `${process.env.HOSTNAME ?? "local"}:${process.pid}`;

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function parsePendingPayload(value: unknown): PendingPayload {
  const payload = asObject(value);
  return payload as PendingPayload;
}

function retryAttempt(payload: PendingPayload): number {
  const raw = payload.retry_attempt;
  return typeof raw === "number" && raw >= 0 ? raw : 0;
}

function retryNotBefore(payload: PendingPayload): Date | null {
  const raw = payload.retry_not_before;
  if (typeof raw !== "string") {
    return null;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function retryBackoffSec(nextAttempt: number): number {
  const exponent = Math.max(0, nextAttempt - 1);
  const capped = Math.min(config.ALERT_DISPATCH_BACKOFF_BASE_SEC * 2 ** exponent, 3600);
  return Math.max(config.ALERT_DISPATCH_BACKOFF_BASE_SEC, capped);
}

async function postJson(url: string, payload: unknown, headers?: Record<string, string>) {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(headers ?? {})
    },
    body: JSON.stringify(payload)
  });
}

async function sendSlack(webhookUrl: string, text: string): Promise<DispatchResult> {
  const response = await postJson(webhookUrl, { text });
  return {
    channel_id: "slack",
    type: "slack",
    ok: response.ok,
    status: response.status,
    error: response.ok ? undefined : await response.text()
  };
}

function formatIncidentMessage(input: {
  incidentId: string;
  severity: string;
  summary: string;
  workflowId: string | null;
  environment: string | null;
  slaDueAt: Date;
  slaBreachedAt: Date | null;
}) {
  return `Synteq Incident ${input.incidentId}\nSeverity: ${input.severity.toUpperCase()}\nWorkflow: ${input.workflowId ?? "n/a"}\nEnv: ${input.environment ?? "n/a"}\nSLA Due: ${input.slaDueAt.toISOString()}\nSLA Breached: ${input.slaBreachedAt ? input.slaBreachedAt.toISOString() : "no"}\n${input.summary}`;
}

export async function claimPendingAlertEvent(eventId: number, currentPayload: unknown) {
  const claimedAt = new Date().toISOString();
  const payload = asObject(currentPayload);
  const claimPayload = {
    ...payload,
    claim: {
      worker_id: dispatchWorkerId,
      claimed_at: claimedAt
    }
  };

  const claimed = await prisma.incidentEvent.updateMany({
    where: {
      id: eventId,
      event_type: "ALERT_PENDING"
    },
    data: {
      event_type: "ALERT_CLAIMED",
      payload_json: claimPayload
    }
  });

  return {
    claimed: claimed.count === 1,
    claimedAt
  };
}

async function scheduleRetryIfNeeded(input: {
  incidentId: string;
  eventId: number;
  payload: PendingPayload;
  dispatchedAt: string;
}): Promise<{ scheduled: boolean; nextAttempt: number; retryNotBefore: string | null }> {
  const currentAttempt = retryAttempt(input.payload);
  const nextAttempt = currentAttempt + 1;
  const shouldRetry = currentAttempt < config.ALERT_DISPATCH_MAX_RETRIES;
  if (!shouldRetry) {
    return {
      scheduled: false,
      nextAttempt,
      retryNotBefore: null
    };
  }

  const backoffSec = retryBackoffSec(nextAttempt);
  const nextRetryAt = new Date(Date.now() + backoffSec * 1000).toISOString();
  await prisma.incidentEvent.create({
    data: {
      incident_id: input.incidentId,
      event_type: "ALERT_PENDING",
      payload_json: {
        retry_attempt: nextAttempt,
        retry_not_before: nextRetryAt,
        previous_event_id: input.eventId,
        previous_dispatched_at: input.dispatchedAt
      }
    }
  });

  return {
    scheduled: true,
    nextAttempt,
    retryNotBefore: nextRetryAt
  };
}

async function skipPendingAlertForPlan(input: {
  eventId: number;
  incidentId: string;
  payload: unknown;
  access: ResolvedTenantAccess;
}): Promise<boolean> {
  const skippedAt = new Date().toISOString();
  const marked = await prisma.incidentEvent.updateMany({
    where: {
      id: input.eventId,
      event_type: "ALERT_PENDING"
    },
    data: {
      event_type: "ALERT_SKIPPED",
      payload_json: {
        original_payload: asObject(input.payload),
        skipped_at: skippedAt,
        reason: "alerts_not_entitled",
        effective_plan: input.access.effectivePlan
      } as Prisma.InputJsonValue
    }
  });

  if (marked.count !== 1) {
    return false;
  }

  await prisma.incidentEvent.create({
    data: {
      incident_id: input.incidentId,
      event_type: "NOTIFICATION_RESULT",
      payload_json: {
        pending_event_id: input.eventId,
        all_ok: false,
        skipped: true,
        skipped_at: skippedAt,
        reason: "alerts_not_entitled",
        effective_plan: input.access.effectivePlan
      }
    }
  });

  return true;
}

export async function dispatchPendingAlertEvents(limit = 100) {
  const pendingEvents = await prisma.incidentEvent.findMany({
    where: {
      event_type: "ALERT_PENDING"
    },
    include: {
      incident: {
        include: {
          policy: {
            include: {
              channels: {
                include: {
                  channel: true
                }
              }
            }
          }
        }
      }
    },
    orderBy: {
      at_time: "asc"
    },
    take: limit
  });
  const tenantAccessCache = new Map<string, ResolvedTenantAccess>();
  const loggedEntitlementDenials = new Set<string>();

  async function accessForTenant(tenantId: string): Promise<ResolvedTenantAccess> {
    const cached = tenantAccessCache.get(tenantId);
    if (cached) {
      return cached;
    }

    const resolved = await resolveTenantAccess({
      tenantId
    });
    tenantAccessCache.set(tenantId, resolved);
    return resolved;
  }

  for (const event of pendingEvents) {
    const incident = event.incident;
    const access = await accessForTenant(incident.tenant_id);
    if (!hasFeature(access, "alerts")) {
      if (!loggedEntitlementDenials.has(incident.tenant_id)) {
        loggedEntitlementDenials.add(incident.tenant_id);
        console.info("alerts.entitlement.skipped", {
          tenant_id: incident.tenant_id,
          feature: "alerts",
          effective_plan: access.effectivePlan
        });
      }
      await skipPendingAlertForPlan({
        eventId: event.id,
        incidentId: incident.id,
        payload: event.payload_json,
        access
      });
      continue;
    }

    const pendingPayload = parsePendingPayload(event.payload_json);
    const notBefore = retryNotBefore(pendingPayload);
    if (notBefore && notBefore.getTime() > Date.now()) {
      continue;
    }

    const claim = await claimPendingAlertEvent(event.id, event.payload_json);
    if (!claim.claimed) {
      continue;
    }

    const policyChannels =
      incident.policy?.channels
        .map((row) => row.channel)
        .filter((channel) => channel.is_enabled) ?? [];

    const message = formatIncidentMessage({
      incidentId: incident.id,
      severity: incident.severity,
      summary: incident.summary,
      workflowId: incident.workflow_id,
      environment: incident.environment,
      slaDueAt: incident.sla_due_at,
      slaBreachedAt: incident.sla_breached_at
    });

    const results: DispatchResult[] = [];
    const dispatchedAt = new Date().toISOString();

    for (const channel of policyChannels) {
      const configJson = channel.config_json as Record<string, unknown>;
      try {
        if (channel.type === "slack") {
          const webhook = typeof configJson.webhook_url === "string" ? configJson.webhook_url : undefined;
          if (!webhook) {
            results.push({
              channel_id: channel.id,
              type: channel.type,
              ok: false,
              error: "Missing webhook_url in channel config"
            });
            continue;
          }

          const result = await sendSlack(webhook, message);
          results.push({ ...result, channel_id: channel.id, type: channel.type });
          continue;
        }

        if (channel.type === "webhook") {
          const url = typeof configJson.url === "string" ? configJson.url : undefined;
          if (!url) {
            results.push({
              channel_id: channel.id,
              type: channel.type,
              ok: false,
              error: "Missing url in channel config"
            });
            continue;
          }

          const response = await postJson(url, {
            incident_id: incident.id,
            severity: incident.severity,
            summary: incident.summary,
            workflow_id: incident.workflow_id,
            environment: incident.environment,
            status: incident.status,
            details: incident.details_json
          });

          results.push({
            channel_id: channel.id,
            type: channel.type,
            ok: response.ok,
            status: response.status,
            error: response.ok ? undefined : await response.text()
          });
          continue;
        }

        if (channel.type === "email") {
          const recipient = typeof configJson.email === "string" ? configJson.email : undefined;
          if (!recipient) {
            results.push({
              channel_id: channel.id,
              type: channel.type,
              ok: false,
              error: "Missing email in channel config"
            });
            continue;
          }

          await sendIncidentAlert({
            email: recipient,
            incidentId: incident.id,
            severity: incident.severity,
            summary: incident.summary
          });

          results.push({
            channel_id: channel.id,
            type: channel.type,
            ok: true
          });
        }
      } catch (error) {
        results.push({
          channel_id: channel.id,
          type: channel.type,
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }

    if (policyChannels.length === 0 && config.SLACK_DEFAULT_WEBHOOK_URL) {
      try {
        const fallbackResult = await sendSlack(config.SLACK_DEFAULT_WEBHOOK_URL, message);
        results.push({
          ...fallbackResult,
          channel_id: "default_slack"
        });
      } catch (error) {
        results.push({
          channel_id: "default_slack",
          type: "slack",
          ok: false,
          error: error instanceof Error ? error.message : "Unknown fallback alert error"
        });
      }
    }

    const allOk = results.length > 0 && results.every((item) => item.ok);
    if (allOk) {
      await prisma.incidentEvent.update({
        where: { id: event.id },
        data: {
          event_type: "ALERT_SENT",
          payload_json: {
            original_payload: event.payload_json,
            claim: {
              worker_id: dispatchWorkerId,
              claimed_at: claim.claimedAt
            },
            dispatched_at: dispatchedAt,
            results
          }
        }
      });
    } else {
      const retry = await scheduleRetryIfNeeded({
        incidentId: incident.id,
        eventId: event.id,
        payload: pendingPayload,
        dispatchedAt
      });

      await prisma.incidentEvent.update({
        where: { id: event.id },
        data: {
          event_type: "ALERT_FAILED",
          payload_json: {
            original_payload: event.payload_json,
            claim: {
              worker_id: dispatchWorkerId,
              claimed_at: claim.claimedAt
            },
            dispatched_at: dispatchedAt,
            retry_scheduled: retry.scheduled,
            retry_attempt: retry.nextAttempt,
            retry_not_before: retry.retryNotBefore,
            results
          }
        }
      });
    }

    await prisma.incidentEvent.create({
      data: {
        incident_id: incident.id,
        event_type: "NOTIFICATION_RESULT",
        payload_json: {
          pending_event_id: event.id,
          all_ok: allOk,
          dispatched_at: dispatchedAt,
          worker_id: dispatchWorkerId,
          results
        }
      }
    });
  }
}
