import type { SupportedCurrency } from "@synteq/shared";
import { prisma } from "../lib/prisma.js";
import { normalizeCurrency } from "./currency-service.js";
import { getTenantEntitlements, type BillingPlan, type TrialStatus } from "./tenant-trial-service.js";

export async function getTenantSettings(tenantId: string): Promise<{
  tenant_id: string;
  default_currency: SupportedCurrency;
  current_plan: BillingPlan;
  effective_plan: BillingPlan;
  trial: {
    status: TrialStatus;
    available: boolean;
    active: boolean;
    consumed: boolean;
    started_at: string | null;
    ends_at: string | null;
    source: "manual" | "auto_ingest" | "auto_real_scan" | "auto_workflow_connect" | null;
    days_remaining: number;
  };
}> {
  const [tenant, entitlements] = await Promise.all([
    prisma.tenant.findUnique({
      where: {
        id: tenantId
      },
      select: {
        id: true,
        default_currency: true
      }
    }),
    getTenantEntitlements({
      tenantId
    })
  ]);

  const trial = entitlements.trial;

  return {
    tenant_id: tenantId,
    default_currency: normalizeCurrency(tenant?.default_currency),
    current_plan: entitlements.current_plan,
    effective_plan: entitlements.effective_plan,
    trial: {
      status: trial.status,
      available: trial.available,
      active: trial.active,
      consumed: trial.consumed,
      started_at: trial.started_at,
      ends_at: trial.ends_at,
      source: trial.source,
      days_remaining: trial.days_remaining
    }
  };
}

export async function updateTenantSettings(input: {
  tenantId: string;
  defaultCurrency: SupportedCurrency;
}): Promise<{
  tenant_id: string;
  default_currency: SupportedCurrency;
  current_plan: BillingPlan;
  effective_plan: BillingPlan;
  trial: {
    status: TrialStatus;
    available: boolean;
    active: boolean;
    consumed: boolean;
    started_at: string | null;
    ends_at: string | null;
    source: "manual" | "auto_ingest" | "auto_real_scan" | "auto_workflow_connect" | null;
    days_remaining: number;
  };
}> {
  const tenant = await prisma.tenant.update({
    where: {
      id: input.tenantId
    },
    data: {
      default_currency: input.defaultCurrency
    },
    select: {
      id: true,
      default_currency: true
    }
  });

  const entitlements = await getTenantEntitlements({
    tenantId: tenant.id
  });

  const trial = entitlements.trial;
  return {
    tenant_id: tenant.id,
    default_currency: normalizeCurrency(tenant.default_currency),
    current_plan: entitlements.current_plan,
    effective_plan: entitlements.effective_plan,
    trial: {
      status: trial.status,
      available: trial.available,
      active: trial.active,
      consumed: trial.consumed,
      started_at: trial.started_at,
      ends_at: trial.ends_at,
      source: trial.source,
      days_remaining: trial.days_remaining
    }
  };
}
