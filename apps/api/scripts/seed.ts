import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { hashApiKey, randomApiKey } from "../src/utils/crypto.js";
import { config } from "../src/config.js";
import { hashPassword } from "../src/utils/password.js";

const DEMO_REQUEST_ID = "synteq-demo-seed-v1";
const DEMO_OPEN_FINGERPRINT = "demo_payments_failure_spike_v1";
const DEMO_RESOLVED_FINGERPRINT = "demo_payments_recovery_v1";

function minutesAgo(minutes: number, now = new Date()) {
  return new Date(now.getTime() - minutes * 60_000);
}

function hoursAgo(hours: number, now = new Date()) {
  return new Date(now.getTime() - hours * 60 * 60_000);
}

async function upsertSeedPolicy(input: {
  tenantId: string;
  workflowId: string;
  name: string;
  metric: string;
  windowSec: number;
  threshold: number;
  comparator: "gt" | "gte" | "lt" | "lte" | "eq";
  minEvents: number;
  severity: "warn" | "low" | "medium" | "high" | "critical";
}) {
  const existing = await prisma.alertPolicy.findFirst({
    where: {
      tenant_id: input.tenantId,
      name: input.name,
      filter_workflow_id: input.workflowId,
      filter_env: "prod"
    }
  });
  const data = {
    tenant_id: input.tenantId,
    name: input.name,
    metric: input.metric,
    window_sec: input.windowSec,
    threshold: input.threshold,
    comparator: input.comparator,
    min_events: input.minEvents,
    severity: input.severity,
    is_enabled: true,
    filter_workflow_id: input.workflowId,
    filter_env: "prod"
  };

  if (existing) {
    return prisma.alertPolicy.update({
      where: {
        id: existing.id
      },
      data
    });
  }

  return prisma.alertPolicy.create({
    data
  });
}

async function seedDemoOperationalEvents(input: { tenantId: string; workflowId: string; workflowSlug: string }) {
  const now = new Date();
  const events = [
    { minutesAgo: 55, status: "succeeded", durationMs: 41000 },
    { minutesAgo: 48, status: "succeeded", durationMs: 42600 },
    { minutesAgo: 42, status: "failed", durationMs: 118000 },
    { minutesAgo: 36, status: "failed", durationMs: 121000 },
    { minutesAgo: 30, status: "succeeded", durationMs: 45500 },
    { minutesAgo: 24, status: "failed", durationMs: 130000 },
    { minutesAgo: 18, status: "timed_out", durationMs: 180000 },
    { minutesAgo: 12, status: "failed", durationMs: 126000 },
    { minutesAgo: 7, status: "failed", durationMs: 132000 },
    { minutesAgo: 4, status: "succeeded", durationMs: 47000 },
    { minutesAgo: 140, status: "succeeded", durationMs: 39000 },
    { minutesAgo: 210, status: "succeeded", durationMs: 40500 },
    { minutesAgo: 360, status: "succeeded", durationMs: 44200 },
    { minutesAgo: 720, status: "failed", durationMs: 98000 },
    { minutesAgo: 1080, status: "succeeded", durationMs: 39500 },
    { minutesAgo: 1500, status: "succeeded", durationMs: 40100 },
    { minutesAgo: 2880, status: "succeeded", durationMs: 38600 },
    { minutesAgo: 4320, status: "succeeded", durationMs: 39700 },
    { minutesAgo: 7200, status: "succeeded", durationMs: 41400 }
  ];

  await prisma.operationalEvent.deleteMany({
    where: {
      tenant_id: input.tenantId,
      request_id: DEMO_REQUEST_ID,
      source: "n8n"
    }
  });

  await prisma.operationalEvent.createMany({
    data: events.map((event, index) => {
      const eventTs = minutesAgo(event.minutesAgo, now);
      const statusSuffix = event.status === "timed_out" ? "timed_out" : event.status;
      return {
        tenant_id: input.tenantId,
        source: "n8n",
        event_type: `workflow_execution_${statusSuffix}`,
        system: `n8n:${input.workflowSlug}`,
        service: "Payments Daily",
        environment: "prod",
        event_ts: eventTs,
        severity: event.status === "succeeded" ? "low" : event.status === "timed_out" ? "medium" : "high",
        correlation_key: `demo-payments-${eventTs.toISOString().slice(0, 13)}`,
        request_id: DEMO_REQUEST_ID,
        metadata_json: {
          demo: true,
          source_type: "n8n",
          source_id: input.workflowId,
          source_key: input.workflowSlug,
          workflow_id: input.workflowId,
          workflow_name: "Payments Daily",
          execution_id: `demo-exec-${String(index + 1).padStart(2, "0")}`,
          status: event.status,
          duration_ms: event.durationMs,
          environment: "prod"
        }
      };
    })
  });

  return events.length;
}

async function seedDemoIncidents(input: { tenantId: string; workflowId: string; failurePolicyId: string }) {
  const now = new Date();
  const existingIncidents = await prisma.incident.findMany({
    where: {
      tenant_id: input.tenantId,
      fingerprint: {
        in: [DEMO_OPEN_FINGERPRINT, DEMO_RESOLVED_FINGERPRINT]
      }
    },
    select: {
      id: true
    }
  });

  if (existingIncidents.length > 0) {
    await prisma.incidentEvent.deleteMany({
      where: {
        incident_id: {
          in: existingIncidents.map((incident) => incident.id)
        }
      }
    });
    await prisma.incident.deleteMany({
      where: {
        id: {
          in: existingIncidents.map((incident) => incident.id)
        }
      }
    });
  }

  const openIncident = await prisma.incident.create({
    data: {
      tenant_id: input.tenantId,
      policy_id: input.failurePolicyId,
      workflow_id: input.workflowId,
      environment: "prod",
      status: "open",
      severity: "high",
      started_at: minutesAgo(42, now),
      last_seen_at: minutesAgo(7, now),
      sla_due_at: minutesAgo(-18, now),
      fingerprint: DEMO_OPEN_FINGERPRINT,
      summary: "Payments Daily failure rate spike",
      details_json: {
        demo: true,
        source: "n8n",
        source_type: "n8n",
        source_key: "payments-daily",
        workflowId: input.workflowId,
        workflow_id: input.workflowId,
        workflowName: "Payments Daily",
        workflow_name: "Payments Daily",
        environment: "prod",
        rule_key: "workflow.failure_rate_spike",
        observed_failures: 5,
        window_minutes: 45,
        synthetic_ratio: 0
      }
    }
  });

  await prisma.incidentEvent.createMany({
    data: [
      {
        incident_id: openIncident.id,
        at_time: minutesAgo(42, now),
        event_type: "BRIDGE_OPENED",
        payload_json: {
          demo: true,
          summary: "Synteq opened the incident after repeated failed workflow executions."
        }
      },
      {
        incident_id: openIncident.id,
        at_time: minutesAgo(24, now),
        event_type: "DETECTED",
        payload_json: {
          demo: true,
          failures: 3,
          rule_key: "workflow.failure_rate_spike"
        }
      },
      {
        incident_id: openIncident.id,
        at_time: minutesAgo(12, now),
        event_type: "BRIDGE_REFRESHED",
        payload_json: {
          demo: true,
          failures: 5,
          last_status: "failed"
        }
      },
      {
        incident_id: openIncident.id,
        at_time: minutesAgo(9, now),
        event_type: "ALERT_PENDING",
        payload_json: {
          demo: true,
          channel: "demo"
        }
      }
    ]
  });

  const resolvedIncident = await prisma.incident.create({
    data: {
      tenant_id: input.tenantId,
      policy_id: input.failurePolicyId,
      workflow_id: input.workflowId,
      environment: "prod",
      status: "resolved",
      severity: "medium",
      started_at: hoursAgo(22, now),
      last_seen_at: hoursAgo(21, now),
      resolved_at: hoursAgo(20, now),
      sla_due_at: hoursAgo(21, now),
      fingerprint: DEMO_RESOLVED_FINGERPRINT,
      summary: "Payments Daily recovered after retry saturation",
      details_json: {
        demo: true,
        source: "n8n",
        source_type: "n8n",
        source_key: "payments-daily",
        workflowId: input.workflowId,
        workflow_id: input.workflowId,
        workflowName: "Payments Daily",
        workflow_name: "Payments Daily",
        environment: "prod",
        rule_key: "workflow.recovery",
        recovery_signal: "successful_run_observed"
      }
    }
  });

  await prisma.incidentEvent.createMany({
    data: [
      {
        incident_id: resolvedIncident.id,
        at_time: hoursAgo(22, now),
        event_type: "BRIDGE_OPENED",
        payload_json: {
          demo: true,
          summary: "A prior failure burst was detected."
        }
      },
      {
        incident_id: resolvedIncident.id,
        at_time: hoursAgo(21, now),
        event_type: "GENERIC_WORKFLOW_RECOVERY",
        payload_json: {
          demo: true,
          status: "succeeded"
        }
      },
      {
        incident_id: resolvedIncident.id,
        at_time: hoursAgo(20, now),
        event_type: "BRIDGE_RESOLVED",
        payload_json: {
          demo: true,
          summary: "Successful workflow signals resolved the incident."
        }
      }
    ]
  });

  return {
    openIncidentId: openIncident.id,
    resolvedIncidentId: resolvedIncident.id
  };
}

async function main() {
  const defaultTenantId = config.DEFAULT_TENANT_ID;
  let tenant;

  if (defaultTenantId) {
    tenant = await prisma.tenant.upsert({
      where: { id: defaultTenantId },
      create: {
        id: defaultTenantId,
        name: "Synteq Demo",
        plan: "free",
        timezone: "UTC"
      },
      update: {}
    });
  } else {
    tenant =
      (await prisma.tenant.findFirst({
        where: { name: "Synteq Demo" }
      })) ??
      (await prisma.tenant.create({
        data: {
          name: "Synteq Demo",
          plan: "free",
          timezone: "UTC"
        }
      }));
  }

  const passwordHash = await hashPassword(config.DASHBOARD_ADMIN_PASSWORD);
  const adminEmail = config.DASHBOARD_ADMIN_EMAIL.toLowerCase();
  const user = await prisma.user.upsert({
    where: {
      tenant_id_email: {
        tenant_id: tenant.id,
        email: adminEmail
      }
    },
    create: {
      tenant_id: tenant.id,
      email: adminEmail,
      full_name: "Synteq Admin",
      password_hash: passwordHash,
      role: "owner",
      email_verified_at: new Date()
    },
    update: {
      password_hash: passwordHash,
      role: "owner",
      disabled_at: null,
      email_verified_at: new Date()
    }
  });

  const rawApiKey = randomApiKey();
  await prisma.apiKey.create({
    data: {
      tenant_id: tenant.id,
      name: `default-ingest-${Date.now()}`,
      key_hash: hashApiKey(rawApiKey, config.SYNTEQ_API_KEY_SALT)
    }
  });

  const workflow = await prisma.workflow.upsert({
    where: {
      tenant_id_slug_environment: {
        tenant_id: tenant.id,
        slug: "payments-daily",
        environment: "prod"
      }
    },
    create: {
      tenant_id: tenant.id,
      slug: "payments-daily",
      display_name: "Payments Daily",
      system: "n8n:payments-daily",
      environment: "prod",
      source_type: "n8n"
    },
    update: {
      display_name: "Payments Daily",
      system: "n8n:payments-daily",
      source_type: "n8n",
      is_active: true
    }
  });

  await prisma.workflowVersion.create({
    data: {
      workflow_id: workflow.id,
      version: `seed-${Date.now()}`,
      config_json: {
        owner: "platform",
        expected_interval_sec: 60
      },
      deployed_at: new Date()
    }
  });

  let channelId: string | null = null;
  if (config.SLACK_DEFAULT_WEBHOOK_URL) {
    const existingChannel = await prisma.alertChannel.findFirst({
      where: {
        tenant_id: tenant.id,
        type: "slack",
        name: "Default Slack"
      }
    });
    const channelData = {
        tenant_id: tenant.id,
        type: "slack",
        name: "Default Slack",
        config_json: {
          webhook_url: config.SLACK_DEFAULT_WEBHOOK_URL
        },
        is_enabled: true
      } as const;
    const channel = existingChannel
      ? await prisma.alertChannel.update({
          where: {
            id: existingChannel.id
          },
          data: channelData
        })
      : await prisma.alertChannel.create({
          data: channelData
        });
    channelId = channel.id;
  }

  const failurePolicy = await upsertSeedPolicy({
    tenantId: tenant.id,
    workflowId: workflow.id,
    name: "Failure Rate Spike",
    metric: "failure_rate",
    windowSec: 300,
    threshold: 0.2,
    comparator: "gte",
    minEvents: 20,
    severity: "high"
  });

  const latencyDriftPolicy = await upsertSeedPolicy({
    tenantId: tenant.id,
    workflowId: workflow.id,
    name: "Latency Drift EWMA",
    metric: "latency_drift_ewma",
    windowSec: 300,
    threshold: 0.25,
    comparator: "gte",
    minEvents: 20,
    severity: "warn"
  });

  const costSpikePolicy = await upsertSeedPolicy({
    tenantId: tenant.id,
    workflowId: workflow.id,
    name: "Cost Spike EWMA",
    metric: "cost_spike",
    windowSec: 300,
    threshold: 1.5,
    comparator: "gte",
    minEvents: 20,
    severity: "medium"
  });

  if (channelId) {
    await prisma.alertPolicyChannel.createMany({
      data: [failurePolicy, latencyDriftPolicy, costSpikePolicy].map((policy) => ({
        policy_id: policy.id,
        channel_id: channelId
      })),
      skipDuplicates: true
    });
  }

  const demoOperationalEventCount = await seedDemoOperationalEvents({
    tenantId: tenant.id,
    workflowId: workflow.id,
    workflowSlug: workflow.slug
  });
  const demoIncidents = await seedDemoIncidents({
    tenantId: tenant.id,
    workflowId: workflow.id,
    failurePolicyId: failurePolicy.id
  });

  console.log("Seed completed");
  console.log(`tenant_id=${tenant.id}`);
  console.log(`admin_email=${adminEmail}`);
  console.log(`raw_api_key=${rawApiKey}`);
  console.log(`workflow_id=${workflow.id}`);
  console.log(`demo_operational_events=${demoOperationalEventCount}`);
  console.log(`demo_open_incident_id=${demoIncidents.openIncidentId}`);
  console.log(`demo_resolved_incident_id=${demoIncidents.resolvedIncidentId}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
