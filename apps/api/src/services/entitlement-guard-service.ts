import type { FastifyReply } from "fastify";
import { getTenantEntitlements, type BillingPlan, type TenantEntitlements } from "./tenant-trial-service.js";

export type EntitlementFeature = "alerts" | "team_members" | "premium_intelligence" | "trend_analysis";

export type ResolvedTenantAccess = {
  tenantId: string;
  currentPlan: BillingPlan;
  effectivePlan: BillingPlan;
  entitlements: TenantEntitlements;
  maxSources: number | null;
  maxHistoryHours: number | null;
  features: Record<EntitlementFeature, boolean>;
};

const PLAN_RANK: Record<BillingPlan, number> = {
  free: 0,
  pro: 1,
  enterprise: 2
};

const FEATURE_MATRIX: Record<BillingPlan, Record<EntitlementFeature, boolean>> = {
  free: {
    alerts: false,
    team_members: false,
    premium_intelligence: false,
    trend_analysis: false
  },
  pro: {
    alerts: true,
    team_members: true,
    premium_intelligence: true,
    trend_analysis: true
  },
  enterprise: {
    alerts: true,
    team_members: true,
    premium_intelligence: true,
    trend_analysis: true
  }
};

type UpgradeRequiredPayload = {
  error: "Upgrade required";
  code: "UPGRADE_REQUIRED";
  message: string;
  tenant_id: string;
  current_plan: BillingPlan;
  effective_plan: BillingPlan;
  required_plan?: BillingPlan;
  feature?: string;
  details?: Record<string, unknown>;
  request_id?: string;
};

export class EntitlementError extends Error {
  readonly statusCode = 403;
  readonly code = "UPGRADE_REQUIRED";
  readonly tenantId: string;
  readonly currentPlan: BillingPlan;
  readonly effectivePlan: BillingPlan;
  readonly requiredPlan?: BillingPlan;
  readonly feature?: string;
  readonly details?: Record<string, unknown>;

  constructor(input: {
    message: string;
    access: ResolvedTenantAccess;
    requiredPlan?: BillingPlan;
    feature?: string;
    details?: Record<string, unknown>;
  }) {
    super(input.message);
    this.name = "EntitlementError";
    this.tenantId = input.access.tenantId;
    this.currentPlan = input.access.currentPlan;
    this.effectivePlan = input.access.effectivePlan;
    this.requiredPlan = input.requiredPlan;
    this.feature = input.feature;
    this.details = input.details;
  }

  toResponse(requestId?: string): UpgradeRequiredPayload {
    return {
      error: "Upgrade required",
      code: "UPGRADE_REQUIRED",
      message: this.message,
      tenant_id: this.tenantId,
      current_plan: this.currentPlan,
      effective_plan: this.effectivePlan,
      required_plan: this.requiredPlan,
      feature: this.feature,
      details: this.details,
      request_id: requestId
    };
  }
}

export function isEntitlementError(error: unknown): error is EntitlementError {
  return error instanceof EntitlementError;
}

export function replyIfEntitlementError(reply: FastifyReply, requestId: string, error: unknown): boolean {
  if (!isEntitlementError(error)) {
    return false;
  }

  reply.code(error.statusCode).send(error.toResponse(requestId));
  return true;
}

export function resolveTenantAccessFromEntitlements(entitlements: TenantEntitlements): ResolvedTenantAccess {
  const effectivePlan = entitlements.effective_plan;

  return {
    tenantId: entitlements.tenant_id,
    currentPlan: entitlements.current_plan,
    effectivePlan,
    entitlements,
    maxSources: effectivePlan === "free" ? 1 : null,
    maxHistoryHours: effectivePlan === "free" ? 24 : null,
    features: FEATURE_MATRIX[effectivePlan]
  };
}

export async function resolveTenantAccess(input: { tenantId: string; now?: Date }): Promise<ResolvedTenantAccess> {
  const entitlements = await getTenantEntitlements({
    tenantId: input.tenantId,
    now: input.now
  });
  return resolveTenantAccessFromEntitlements(entitlements);
}

export function hasPlanAtLeast(access: ResolvedTenantAccess, minimumPlan: BillingPlan): boolean {
  return PLAN_RANK[access.effectivePlan] >= PLAN_RANK[minimumPlan];
}

export function requirePlanAtLeast(access: ResolvedTenantAccess, minimumPlan: BillingPlan): void {
  if (hasPlanAtLeast(access, minimumPlan)) {
    return;
  }

  throw new EntitlementError({
    message: `This action requires the ${minimumPlan} plan.`,
    access,
    requiredPlan: minimumPlan,
    feature: "plan"
  });
}

export function hasFeature(access: ResolvedTenantAccess, feature: EntitlementFeature): boolean {
  return access.features[feature];
}

export function requireFeature(access: ResolvedTenantAccess, feature: EntitlementFeature): void {
  if (hasFeature(access, feature)) {
    return;
  }

  throw new EntitlementError({
    message: `This action requires the Pro plan feature: ${feature}.`,
    access,
    requiredPlan: "pro",
    feature
  });
}

export function requireSourceCapacity(input: {
  access: ResolvedTenantAccess;
  currentActiveSources: number;
  existingSource?: boolean;
}): void {
  if (input.existingSource) {
    return;
  }

  const maxSources = input.access.maxSources;
  if (maxSources === null) {
    return;
  }

  if (input.currentActiveSources < maxSources) {
    return;
  }

  throw new EntitlementError({
    message: `Source limit reached. Free plan supports up to ${maxSources} active source.`,
    access: input.access,
    requiredPlan: "pro",
    feature: "source_capacity",
    details: {
      active_sources: input.currentActiveSources,
      max_sources: maxSources
    }
  });
}

export function requireTeamAccess(access: ResolvedTenantAccess): void {
  requireFeature(access, "team_members");
}

export function requireHistoryAccess<T extends string>(input: {
  access: ResolvedTenantAccess;
  requestedRange: T;
  defaultRange: T;
  rangeToHours: Record<T, number>;
}): { range: T; clamped: boolean } {
  const maxHistoryHours = input.access.maxHistoryHours;
  const selected = input.requestedRange;

  if (maxHistoryHours === null) {
    return {
      range: selected,
      clamped: false
    };
  }

  const requestedHours = input.rangeToHours[selected];
  if (requestedHours <= maxHistoryHours) {
    return {
      range: selected,
      clamped: false
    };
  }

  let bestRange: T | null = null;
  let bestHours = -1;
  for (const [range, hours] of Object.entries(input.rangeToHours) as Array<[T, number]>) {
    if (hours <= maxHistoryHours && hours > bestHours) {
      bestRange = range;
      bestHours = hours;
    }
  }

  if (bestRange === null) {
    throw new EntitlementError({
      message: "Requested history window is not available on this plan.",
      access: input.access,
      requiredPlan: "pro",
      feature: "history_access",
      details: {
        requested_range: selected,
        max_history_hours: maxHistoryHours
      }
    });
  }

  return {
    range: bestRange,
    clamped: bestRange !== selected
  };
}
