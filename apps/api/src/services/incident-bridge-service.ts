import { prisma } from "../lib/prisma.js";
import { sha256 } from "../utils/crypto.js";
import { hasFeature, resolveTenantAccess, type ResolvedTenantAccess } from "./entitlement-guard-service.js";
import {
  incidentSummaryFromFinding,
  incidentTitleForRule,
  incidentBridgeRules,
  isEligibleFinding
} from "./incident-bridge-rules.js";
import { openOrRefreshBridgeIncident, resolveBridgeIncident } from "./incidents-service.js";

type Logger = {
  info: (message: string, payload?: Record<string, unknown>) => void;
  warn: (message: string, payload?: Record<string, unknown>) => void;
  error: (message: string, payload?: Record<string, unknown>) => void;
};

type OperationalFindingRow = {
  id: string;
  tenant_id: string;
  source: string;
  rule_key: string;
  severity: "warn" | "low" | "medium" | "high" | "critical";
  status: "open" | "resolved";
  system: string;
  correlation_key: string | null;
  fingerprint: string;
  summary: string;
  evidence_json: unknown;
  first_seen_at: Date;
  last_seen_at: Date;
  updated_at: Date;
  event_count: number;
};

type BridgeCursorRow = {
  worker_key: string;
  last_finding_updated_at: Date | null;
  last_finding_id: string | null;
};

type FindingIncidentLinkRow = {
  id: number;
  tenant_id: string;
  finding_id: string;
  incident_id: string;
  bridge_key: string;
  last_bridged_at: Date;
};

type BridgeClient = {
  operationalFinding: {
    findMany: (args: Record<string, unknown>) => Promise<OperationalFindingRow[]>;
  };
  incidentBridgeCursor: {
    findUnique: (args: Record<string, unknown>) => Promise<BridgeCursorRow | null>;
    upsert: (args: Record<string, unknown>) => Promise<unknown>;
  };
  findingIncidentLink: {
    findUnique: (args: Record<string, unknown>) => Promise<FindingIncidentLinkRow | null>;
    upsert: (args: Record<string, unknown>) => Promise<unknown>;
    update: (args: Record<string, unknown>) => Promise<unknown>;
  };
};

type TenantAccessResolver = (input: { tenantId: string; now: Date }) => Promise<ResolvedTenantAccess>;

const defaultLogger: Logger = {
  info: (message, payload) => console.info(message, payload ?? {}),
  warn: (message, payload) => console.warn(message, payload ?? {}),
  error: (message, payload) => console.error(message, payload ?? {})
};

function compactEvidence(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  const source = input as Record<string, unknown>;
  const entries = Object.entries(source).slice(0, 12).map(([key, value]) => {
    if (Array.isArray(value)) {
      return [key, value.slice(0, 10)];
    }
    return [key, value];
  });
  return Object.fromEntries(entries);
}

function buildIncidentCandidate(finding: OperationalFindingRow) {
  const title = incidentTitleForRule({
    ruleKey: finding.rule_key,
    system: finding.system
  });
  const summary = incidentSummaryFromFinding({
    title,
    ruleKey: finding.rule_key,
    system: finding.system,
    correlationKey: finding.correlation_key,
    firstSeenAt: finding.first_seen_at,
    lastSeenAt: finding.last_seen_at
  });
  const incidentFingerprint = sha256(`incident_bridge|${finding.tenant_id}|${finding.fingerprint}`);

  return {
    severity: finding.severity,
    summary,
    incidentFingerprint,
    details: {
      source: "operational_finding_bridge",
      finding_id: finding.id,
      finding_fingerprint: finding.fingerprint,
      finding_rule_key: finding.rule_key,
      finding_status: finding.status,
      system: finding.system,
      correlation_key: finding.correlation_key,
      first_seen_at: finding.first_seen_at.toISOString(),
      last_seen_at: finding.last_seen_at.toISOString(),
      event_count: finding.event_count,
      evidence: compactEvidence(finding.evidence_json)
    } satisfies Record<string, unknown>
  };
}

export type IncidentBridgeRunResult = {
  processed_findings: number;
  incidents_created: number;
  incidents_refreshed: number;
  incidents_resolved: number;
  cursor_advanced: boolean;
};

export async function runIncidentBridgeBatch(input?: {
  client?: BridgeClient;
  logger?: Logger;
  batchSize?: number;
  resolveAccess?: TenantAccessResolver;
}): Promise<IncidentBridgeRunResult> {
  const client = input?.client ?? (prisma as unknown as BridgeClient);
  const logger = input?.logger ?? defaultLogger;
  const batchSize = input?.batchSize ?? incidentBridgeRules.batchSize;
  const workerKey = incidentBridgeRules.workerKey;
  const now = new Date();
  const resolveAccess = input?.resolveAccess ?? resolveTenantAccess;
  const tenantPremiumIntelligenceCache = new Map<string, boolean>();
  const loggedEntitlementDenials = new Set<string>();

  async function hasPremiumIntelligence(tenantId: string): Promise<boolean> {
    const cached = tenantPremiumIntelligenceCache.get(tenantId);
    if (cached !== undefined) {
      return cached;
    }

    const access = await resolveAccess({
      tenantId,
      now
    });
    const entitled = hasFeature(access, "premium_intelligence");
    tenantPremiumIntelligenceCache.set(tenantId, entitled);
    if (!entitled && !loggedEntitlementDenials.has(tenantId)) {
      loggedEntitlementDenials.add(tenantId);
      logger.info("incident-bridge.entitlement.skipped", {
        tenant_id: tenantId,
        feature: "premium_intelligence",
        effective_plan: access.effectivePlan
      });
    }
    return entitled;
  }

  const cursor = await client.incidentBridgeCursor.findUnique({
    where: {
      worker_key: workerKey
    }
  });

  const findings = await client.operationalFinding.findMany({
    where: {
      source: incidentBridgeRules.eligibleSource,
      rule_key: {
        in: [...incidentBridgeRules.eligibleRuleKeys]
      },
      status: {
        in: ["open", "resolved"]
      },
      ...(cursor?.last_finding_updated_at
        ? {
            OR: [
              {
                updated_at: {
                  gt: cursor.last_finding_updated_at
                }
              },
              {
                AND: [
                  {
                    updated_at: cursor.last_finding_updated_at
                  },
                  {
                    id: {
                      gt: cursor.last_finding_id ?? ""
                    }
                  }
                ]
              }
            ]
          }
        : {})
    },
    orderBy: [{ updated_at: "asc" }, { id: "asc" }],
    take: batchSize,
    select: {
      id: true,
      tenant_id: true,
      source: true,
      rule_key: true,
      severity: true,
      status: true,
      system: true,
      correlation_key: true,
      fingerprint: true,
      summary: true,
      evidence_json: true,
      first_seen_at: true,
      last_seen_at: true,
      updated_at: true,
      event_count: true
    }
  });

  if (findings.length === 0) {
    logger.info("incident-bridge.batch.noop", { worker_key: workerKey });
    return {
      processed_findings: 0,
      incidents_created: 0,
      incidents_refreshed: 0,
      incidents_resolved: 0,
      cursor_advanced: false
    };
  }

  let incidentsCreated = 0;
  let incidentsRefreshed = 0;
  let incidentsResolved = 0;

  for (const finding of findings) {
    if (!(await hasPremiumIntelligence(finding.tenant_id))) {
      continue;
    }

    if (!isEligibleFinding({ source: finding.source, ruleKey: finding.rule_key, status: finding.status })) {
      continue;
    }

    const existingLink = await client.findingIncidentLink.findUnique({
      where: {
        finding_id: finding.id
      }
    });

    if (finding.status === "open") {
      const candidate = buildIncidentCandidate(finding);
      const result = await openOrRefreshBridgeIncident({
        tenantId: finding.tenant_id,
        incidentId: existingLink?.incident_id ?? null,
        severity: candidate.severity,
        summary: candidate.summary,
        fingerprint: candidate.incidentFingerprint,
        details: candidate.details,
        lastSeenAt: finding.last_seen_at
      });

      await client.findingIncidentLink.upsert({
        where: {
          finding_id: finding.id
        },
        create: {
          tenant_id: finding.tenant_id,
          finding_id: finding.id,
          incident_id: result.incident.id,
          bridge_key: finding.fingerprint,
          last_bridged_at: now
        },
        update: {
          incident_id: result.incident.id,
          bridge_key: finding.fingerprint,
          last_bridged_at: now
        }
      });

      if (result.action === "created") {
        incidentsCreated += 1;
        logger.info("incident-bridge.finding.linked", {
          tenant_id: finding.tenant_id,
          finding_id: finding.id,
          incident_id: result.incident.id,
          action: "created"
        });
      } else {
        incidentsRefreshed += 1;
        logger.info("incident-bridge.finding.linked", {
          tenant_id: finding.tenant_id,
          finding_id: finding.id,
          incident_id: result.incident.id,
          action: "updated"
        });
      }
      continue;
    }

    if (!existingLink) {
      continue;
    }

    const resolution = await resolveBridgeIncident({
      tenantId: finding.tenant_id,
      incidentId: existingLink.incident_id,
      resolvedAt: finding.last_seen_at,
      reason: `finding_resolved:${finding.rule_key}`
    });
    await client.findingIncidentLink.update({
      where: {
        id: existingLink.id
      },
      data: {
        last_bridged_at: now
      }
    });
    if (resolution.resolved) {
      incidentsResolved += 1;
      logger.info("incident-bridge.finding.resolved", {
        tenant_id: finding.tenant_id,
        finding_id: finding.id,
        incident_id: existingLink.incident_id
      });
    }
  }

  const lastFinding = findings[findings.length - 1];
  await client.incidentBridgeCursor.upsert({
    where: {
      worker_key: workerKey
    },
    create: {
      worker_key: workerKey,
      last_finding_updated_at: lastFinding.updated_at,
      last_finding_id: lastFinding.id
    },
    update: {
      last_finding_updated_at: lastFinding.updated_at,
      last_finding_id: lastFinding.id
    }
  });

  // Deferred by design: enqueue alert fan-out/escalation policy enrichment after bridge stabilization.
  logger.info("incident-bridge.batch.completed", {
    processed_findings: findings.length,
    incidents_created: incidentsCreated,
    incidents_refreshed: incidentsRefreshed,
    incidents_resolved: incidentsResolved
  });

  return {
    processed_findings: findings.length,
    incidents_created: incidentsCreated,
    incidents_refreshed: incidentsRefreshed,
    incidents_resolved: incidentsResolved,
    cursor_advanced: true
  };
}
