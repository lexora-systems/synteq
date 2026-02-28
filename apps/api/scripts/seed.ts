import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { hashApiKey, randomApiKey } from "../src/utils/crypto.js";
import { config } from "../src/config.js";

async function main() {
  const defaultTenantId = config.DEFAULT_TENANT_ID;
  let tenant;

  if (defaultTenantId) {
    tenant = await prisma.tenant.upsert({
      where: { id: defaultTenantId },
      create: {
        id: defaultTenantId,
        name: "Synteq Demo",
        plan: "mvp",
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
          plan: "mvp",
          timezone: "UTC"
        }
      }));
  }

  const user = await prisma.user.upsert({
    where: {
      tenant_id_email: {
        tenant_id: tenant.id,
        email: config.DASHBOARD_ADMIN_EMAIL
      }
    },
    create: {
      tenant_id: tenant.id,
      email: config.DASHBOARD_ADMIN_EMAIL,
      full_name: "Synteq Admin",
      role: "admin",
      is_active: true
    },
    update: {
      is_active: true,
      role: "admin"
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
      system: "airflow",
      environment: "prod"
    },
    update: {
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
    const channel = await prisma.alertChannel.create({
      data: {
        tenant_id: tenant.id,
        type: "slack",
        name: "Default Slack",
        config_json: {
          webhook_url: config.SLACK_DEFAULT_WEBHOOK_URL
        },
        is_enabled: true
      }
    });
    channelId = channel.id;
  }

  const failurePolicy = await prisma.alertPolicy.create({
    data: {
      tenant_id: tenant.id,
      name: "Failure Rate Spike",
      metric: "failure_rate",
      window_sec: 300,
      threshold: 0.2,
      comparator: "gte",
      min_events: 20,
      severity: "high",
      is_enabled: true,
      filter_workflow_id: workflow.id,
      filter_env: "prod"
    }
  });

  const latencyDriftPolicy = await prisma.alertPolicy.create({
    data: {
      tenant_id: tenant.id,
      name: "Latency Drift EWMA",
      metric: "latency_drift_ewma",
      window_sec: 300,
      threshold: 0.25,
      comparator: "gte",
      min_events: 20,
      severity: "warn",
      is_enabled: true,
      filter_workflow_id: workflow.id,
      filter_env: "prod"
    }
  });

  const costSpikePolicy = await prisma.alertPolicy.create({
    data: {
      tenant_id: tenant.id,
      name: "Cost Spike EWMA",
      metric: "cost_spike",
      window_sec: 300,
      threshold: 1.5,
      comparator: "gte",
      min_events: 20,
      severity: "medium",
      is_enabled: true,
      filter_workflow_id: workflow.id,
      filter_env: "prod"
    }
  });

  if (channelId) {
    await prisma.alertPolicyChannel.createMany({
      data: [failurePolicy, latencyDriftPolicy, costSpikePolicy].map((policy) => ({
        policy_id: policy.id,
        channel_id: channelId
      }))
    });
  }

  console.log("Seed completed");
  console.log(`tenant_id=${tenant.id}`);
  console.log(`admin_email=${user.email}`);
  console.log(`raw_api_key=${rawApiKey}`);
  console.log(`workflow_id=${workflow.id}`);
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
