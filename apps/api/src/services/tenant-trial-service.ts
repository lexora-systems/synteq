import { prisma } from "../lib/prisma.js";

const TRIAL_DURATION_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PAID_PLAN_VARIANTS = ["pro", "enterprise", "PRO", "ENTERPRISE", "Pro", "Enterprise"];

export type BillingPlan = "free" | "pro" | "enterprise";
export type TrialStatus = "none" | "active" | "expired";
export type TrialSource = "manual" | "auto_ingest" | "auto_real_scan" | "auto_workflow_connect";
export type StartTrialResultCode = "started" | "already_active" | "already_used" | "not_eligible";

type TenantTrialRow = {
  id: string;
  plan: string;
  trial_status: string;
  trial_started_at: Date | null;
  trial_ends_at: Date | null;
  trial_source: string | null;
};

type TenantTrialClient = {
  tenant: {
    findUnique: (args: Record<string, unknown>) => Promise<TenantTrialRow | null>;
    updateMany: (args: Record<string, unknown>) => Promise<{ count: number }>;
    update: (args: Record<string, unknown>) => Promise<unknown>;
  };
};

export type TenantEntitlements = {
  tenant_id: string;
  current_plan: BillingPlan;
  effective_plan: BillingPlan;
  trial: {
    status: TrialStatus;
    available: boolean;
    active: boolean;
    consumed: boolean;
    started_at: string | null;
    ends_at: string | null;
    source: TrialSource | null;
    days_remaining: number;
  };
};

export type StartTrialResult = {
  code: StartTrialResultCode;
  entitlements: TenantEntitlements;
};

function addTrialDuration(startedAt: Date) {
  return new Date(startedAt.getTime() + TRIAL_DURATION_DAYS * MS_PER_DAY);
}

function toBillingPlan(plan: string): BillingPlan {
  const normalized = plan.trim().toLowerCase();
  if (normalized === "pro") {
    return "pro";
  }
  if (normalized === "enterprise") {
    return "enterprise";
  }
  return "free";
}

function toTrialSource(value: string | null): TrialSource | null {
  if (!value) {
    return null;
  }
  if (value === "manual" || value === "auto_ingest" || value === "auto_real_scan" || value === "auto_workflow_connect") {
    return value;
  }
  return null;
}

function deriveTrialStatus(row: TenantTrialRow, now: Date): TrialStatus {
  if (!row.trial_started_at) {
    return "none";
  }
  if (row.trial_ends_at && row.trial_ends_at.getTime() > now.getTime()) {
    return "active";
  }
  return "expired";
}

function daysRemaining(trialEndsAt: Date | null, now: Date) {
  if (!trialEndsAt) {
    return 0;
  }
  const remainingMs = trialEndsAt.getTime() - now.getTime();
  if (remainingMs <= 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(remainingMs / MS_PER_DAY));
}

function resolveEffectivePlan(currentPlan: BillingPlan, trialStatus: TrialStatus): BillingPlan {
  if (currentPlan === "enterprise") {
    return "enterprise";
  }
  if (currentPlan === "pro") {
    return "pro";
  }
  return trialStatus === "active" ? "pro" : "free";
}

export function resolveTenantEntitlementsFromRow(row: TenantTrialRow, now = new Date()): TenantEntitlements {
  const currentPlan = toBillingPlan(row.plan);
  const status = deriveTrialStatus(row, now);
  const consumed = row.trial_started_at !== null;
  const active = status === "active";
  const available = currentPlan === "free" && !consumed;
  const effectivePlan = resolveEffectivePlan(currentPlan, status);

  return {
    tenant_id: row.id,
    current_plan: currentPlan,
    effective_plan: effectivePlan,
    trial: {
      status,
      available,
      active,
      consumed,
      started_at: row.trial_started_at?.toISOString() ?? null,
      ends_at: row.trial_ends_at?.toISOString() ?? null,
      source: toTrialSource(row.trial_source),
      days_remaining: active ? daysRemaining(row.trial_ends_at, now) : 0
    }
  };
}

async function loadTenantTrialRow(tenantId: string, client: TenantTrialClient): Promise<TenantTrialRow | null> {
  return client.tenant.findUnique({
    where: {
      id: tenantId
    },
    select: {
      id: true,
      plan: true,
      trial_status: true,
      trial_started_at: true,
      trial_ends_at: true,
      trial_source: true
    }
  });
}

async function syncStoredTrialStatus(input: {
  row: TenantTrialRow;
  now: Date;
  client: TenantTrialClient;
}) {
  const derivedStatus = deriveTrialStatus(input.row, input.now);
  if (input.row.trial_status === derivedStatus) {
    return;
  }

  await input.client.tenant.update({
    where: {
      id: input.row.id
    },
    data: {
      trial_status: derivedStatus
    }
  });
}

function defaultNotEligibleEntitlements(tenantId: string): TenantEntitlements {
  return {
    tenant_id: tenantId,
    current_plan: "free",
    effective_plan: "free",
    trial: {
      status: "none",
      available: false,
      active: false,
      consumed: false,
      started_at: null,
      ends_at: null,
      source: null,
      days_remaining: 0
    }
  };
}

export async function getTenantEntitlements(input: {
  tenantId: string;
  now?: Date;
  client?: TenantTrialClient;
}): Promise<TenantEntitlements> {
  const client = input.client ?? (prisma as unknown as TenantTrialClient);
  const now = input.now ?? new Date();
  const row = await loadTenantTrialRow(input.tenantId, client);
  if (!row) {
    return defaultNotEligibleEntitlements(input.tenantId);
  }

  await syncStoredTrialStatus({
    row,
    now,
    client
  });

  return resolveTenantEntitlementsFromRow(row, now);
}

export async function startTrialIfEligible(input: {
  tenantId: string;
  source: TrialSource;
  now?: Date;
  client?: TenantTrialClient;
}): Promise<StartTrialResult> {
  const client = input.client ?? (prisma as unknown as TenantTrialClient);
  const now = input.now ?? new Date();
  const row = await loadTenantTrialRow(input.tenantId, client);
  if (!row) {
    return {
      code: "not_eligible",
      entitlements: defaultNotEligibleEntitlements(input.tenantId)
    };
  }

  const entitlements = resolveTenantEntitlementsFromRow(row, now);
  if (entitlements.current_plan !== "free") {
    return {
      code: "not_eligible",
      entitlements
    };
  }

  if (entitlements.trial.active) {
    return {
      code: "already_active",
      entitlements
    };
  }

  if (entitlements.trial.consumed) {
    return {
      code: "already_used",
      entitlements
    };
  }

  const trialEndsAt = addTrialDuration(now);
  const started = await client.tenant.updateMany({
    where: {
      id: input.tenantId,
      trial_started_at: null,
      NOT: [
        {
          plan: {
            in: PAID_PLAN_VARIANTS
          }
        }
      ]
    },
    data: {
      trial_status: "active",
      trial_started_at: now,
      trial_ends_at: trialEndsAt,
      trial_source: input.source
    }
  });

  if (started.count === 1) {
    return {
      code: "started",
      entitlements: resolveTenantEntitlementsFromRow(
        {
          ...row,
          trial_status: "active",
          trial_started_at: now,
          trial_ends_at: trialEndsAt,
          trial_source: input.source
        },
        now
      )
    };
  }

  const latest = await loadTenantTrialRow(input.tenantId, client);
  if (!latest) {
    return {
      code: "not_eligible",
      entitlements: defaultNotEligibleEntitlements(input.tenantId)
    };
  }
  const latestEntitlements = resolveTenantEntitlementsFromRow(latest, now);

  if (latestEntitlements.trial.active) {
    return {
      code: "already_active",
      entitlements: latestEntitlements
    };
  }

  if (latestEntitlements.trial.consumed) {
    return {
      code: "already_used",
      entitlements: latestEntitlements
    };
  }

  return {
    code: "not_eligible",
    entitlements: latestEntitlements
  };
}
