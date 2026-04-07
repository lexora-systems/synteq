export const synteqDataContract = {
  purpose: "Operational risk intelligence from event-level signals",
  collectsByDefault: [
    "source identity and tenant routing context",
    "workflow/job/run identifiers",
    "status, conclusion, retries, and timing signals",
    "operational event metadata required for detections, findings, incidents, and alerts",
    "source connection metadata such as status and last_seen timestamps"
  ],
  doesNotCollectByDefault: [
    "source code contents",
    "repository file contents",
    "build artifact contents",
    "full execution logs",
    "customer system secrets"
  ],
  github: {
    collectsByDefault: [
      "repository identity",
      "workflow/job/run ids and names",
      "conclusion/status/attempt/timing signals",
      "branch and commit sha for correlation context"
    ],
    doesNotCollectByDefault: [
      "repository contents",
      "source code contents",
      "artifact contents",
      "full logs"
    ]
  },
  credentialHandling: {
    uses: [
      "webhook secrets for signature verification",
      "ingestion API keys for request authentication"
    ],
    notUsedAs: ["analysis payload input"]
  }
} as const;

export const blockedMetadataKeyPatterns = [
  /secret/i,
  /password/i,
  /passwd/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /auth[_-]?token/i,
  /id[_-]?token/i,
  /bearer/i,
  /jwt/i,
  /session[_-]?token/i,
  /authorization/i,
  /cookie/i,
  /credential/i,
  /private[_-]?key/i,
  /api[_-]?key/i,
  /^x[-_]?hub[-_]?signature/i,
  /^webhook[_-]?secret/i,
  /(^|[_-])(log|logs|stdout|stderr|stack|stacktrace|trace)([_-]|$)/i,
  /artifact/i,
  /source[_-]?code/i,
  /repository[_-]?contents/i,
  /full[_-]?payload/i,
  /^raw$/i,
  /^raw[_-]?payload$/i
] as const;

export const payloadSignalSnapshotKeys = ["simulation", "synthetic", "scenario", "expected_interval_sec"] as const;
