import { config } from "../config.js";
import { prisma } from "../lib/prisma.js";

type DispatchResult = {
  channel_id: string;
  type: string;
  ok: boolean;
  status?: number;
  error?: string;
};

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

  for (const event of pendingEvents) {
    const incident = event.incident;
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
          results.push({
            channel_id: channel.id,
            type: channel.type,
            ok: false,
            error: "Email channel not implemented in MVP"
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
    await prisma.incidentEvent.update({
      where: { id: event.id },
      data: {
        event_type: allOk ? "ALERT_SENT" : "ALERT_FAILED",
        payload_json: {
          original_payload: event.payload_json,
          dispatched_at: new Date().toISOString(),
          results
        }
      }
    });

    await prisma.incidentEvent.create({
      data: {
        incident_id: incident.id,
        event_type: "NOTIFICATION_RESULT",
        payload_json: {
          pending_event_id: event.id,
          all_ok: allOk,
          results
        }
      }
    });
  }
}
