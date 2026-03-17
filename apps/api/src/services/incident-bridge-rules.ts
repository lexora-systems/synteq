export const incidentBridgeRules = {
  workerKey: "incident_bridge_v1",
  batchSize: 150,
  eligibleSource: "github_actions",
  eligibleRuleKeys: [
    "github.workflow_failed",
    "github.job_failed_burst",
    "github.workflow_stuck",
    "github.job_stuck"
  ] as const
};

export type EligibleRuleKey = (typeof incidentBridgeRules.eligibleRuleKeys)[number];

export function isEligibleFinding(input: { source: string; ruleKey: string; status: string }) {
  if (input.source !== incidentBridgeRules.eligibleSource) {
    return false;
  }

  if (!incidentBridgeRules.eligibleRuleKeys.includes(input.ruleKey as EligibleRuleKey)) {
    return false;
  }

  return input.status === "open" || input.status === "resolved";
}

export function incidentTitleForRule(input: { ruleKey: string; system: string }) {
  if (input.ruleKey === "github.workflow_failed") {
    return `GitHub workflow failure detected in ${input.system}`;
  }
  if (input.ruleKey === "github.job_failed_burst") {
    return `GitHub job failure burst detected in ${input.system}`;
  }
  if (input.ruleKey === "github.workflow_stuck") {
    return `GitHub workflow appears stuck in ${input.system}`;
  }
  if (input.ruleKey === "github.job_stuck") {
    return `GitHub job appears stuck in ${input.system}`;
  }

  return `Operational issue detected in ${input.system}`;
}

export function incidentSummaryFromFinding(input: {
  title: string;
  ruleKey: string;
  system: string;
  correlationKey: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
}) {
  const correlation = input.correlationKey ? ` correlation=${input.correlationKey}` : "";
  return `${input.title}. rule=${input.ruleKey} system=${input.system}${correlation} first_seen=${input.firstSeenAt.toISOString()} last_seen=${input.lastSeenAt.toISOString()}`;
}
