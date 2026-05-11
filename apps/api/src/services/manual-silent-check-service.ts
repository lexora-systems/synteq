import { prisma } from "../lib/prisma.js";

export type ManualSilentCheckStatus = "ok" | "warning" | "failed";

export type ManualSilentCheckResult = {
  sourceId: string;
  status: ManualSilentCheckStatus;
  mode: "silent";
  writesPerformed: false;
  checkedAt: string;
  checks: Array<{
    key: string;
    status: ManualSilentCheckStatus;
    message: string;
  }>;
};

type WorkflowSourceRow = {
  id: string;
  tenant_id: string;
  display_name: string;
  slug: string;
  source_type: string;
  environment: string;
  is_active: boolean;
  versions?: Array<{
    config_json: unknown;
  }>;
};

type ManualSilentCheckClient = {
  workflow: {
    findFirst: (args: Record<string, unknown>) => Promise<WorkflowSourceRow | null>;
  };
  gitHubIntegration: {
    findFirst: (args: Record<string, unknown>) => Promise<{ id: string } | null>;
  };
};

export class ManualSilentCheckNotFoundError extends Error {
  constructor() {
    super("Workflow source not found");
    this.name = "ManualSilentCheckNotFoundError";
  }
}

export class ManualSilentCheckUnsupportedSourceError extends Error {
  constructor(message = "Silent checks are only supported for generic workflow sources") {
    super(message);
    this.name = "ManualSilentCheckUnsupportedSourceError";
  }
}

const genericWorkflowSourceTypes = new Set(["webhook", "n8n", "make", "zapier"]);
const sensitiveConfigKeyPattern =
  /(^|[_-])(secret|token|password|credential|authorization|cookie|private|raw|payload|payload_json|api[_-]?key|webhook[_-]?url|callback[_-]?url)($|[_-])/i;

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isGenericWorkflowSourceType(value: string) {
  return genericWorkflowSourceTypes.has(value);
}

function countSensitiveConfigKeys(value: unknown, depth = 0): number {
  if (!value || depth > 8) {
    return 0;
  }

  if (Array.isArray(value)) {
    return value.reduce((count, item) => count + countSensitiveConfigKeys(item, depth + 1), 0);
  }

  if (typeof value !== "object") {
    return 0;
  }

  return Object.entries(value as Record<string, unknown>).reduce((count, [key, nested]) => {
    const keyMatch = sensitiveConfigKeyPattern.test(key) ? 1 : 0;
    return count + keyMatch + countSensitiveConfigKeys(nested, depth + 1);
  }, 0);
}

function aggregateStatus(checks: ManualSilentCheckResult["checks"]): ManualSilentCheckStatus {
  if (checks.some((check) => check.status === "failed")) {
    return "failed";
  }

  if (checks.some((check) => check.status === "warning")) {
    return "warning";
  }

  return "ok";
}

export async function runManualSilentCheck(input: {
  tenantId: string;
  sourceId: string;
  now?: Date;
  client?: ManualSilentCheckClient;
}): Promise<ManualSilentCheckResult> {
  const client = input.client ?? (prisma as unknown as ManualSilentCheckClient);
  const checkedAt = (input.now ?? new Date()).toISOString();

  const source = await client.workflow.findFirst({
    where: {
      id: input.sourceId,
      tenant_id: input.tenantId
    },
    select: {
      id: true,
      tenant_id: true,
      display_name: true,
      slug: true,
      source_type: true,
      environment: true,
      is_active: true,
      versions: {
        orderBy: {
          created_at: "desc"
        },
        take: 1,
        select: {
          config_json: true
        }
      }
    }
  });

  if (!source) {
    const githubSource = await client.gitHubIntegration.findFirst({
      where: {
        id: input.sourceId,
        tenant_id: input.tenantId
      },
      select: {
        id: true
      }
    });

    if (githubSource) {
      throw new ManualSilentCheckUnsupportedSourceError("GitHub sources cannot use generic workflow silent checks");
    }

    throw new ManualSilentCheckNotFoundError();
  }

  if (!isGenericWorkflowSourceType(source.source_type)) {
    throw new ManualSilentCheckUnsupportedSourceError();
  }

  const latestConfig = source.versions?.[0]?.config_json;
  const missingRequiredFields = [
    hasText(source.display_name) ? null : "display_name",
    hasText(source.slug) ? null : "slug",
    hasText(source.source_type) ? null : "source_type",
    hasText(source.environment) ? null : "environment"
  ].filter(Boolean);
  const unsafeConfigKeyCount = countSensitiveConfigKeys(latestConfig);

  const checks: ManualSilentCheckResult["checks"] = [
    {
      key: "source_access",
      status: "ok",
      message: "Source belongs to this workspace and is readable."
    },
    {
      key: "source_activation",
      status: source.is_active ? "ok" : "failed",
      message: source.is_active ? "Source is active for manual validation." : "Source is inactive and is not ready for validation."
    },
    {
      key: "source_compatibility",
      status: "ok",
      message: "Source uses the generic workflow event contract."
    },
    {
      key: "required_configuration",
      status: missingRequiredFields.length === 0 ? "ok" : "failed",
      message:
        missingRequiredFields.length === 0
          ? "Required source identity fields are present."
          : "Source is missing required identity fields."
    },
    {
      key: "setup_configuration",
      status: latestConfig ? "ok" : "warning",
      message: latestConfig
        ? "Workflow source setup configuration is present."
        : "Workflow setup configuration was not found; older sources may still ingest events correctly."
    },
    {
      key: "configuration_integrity",
      status: unsafeConfigKeyCount === 0 ? "ok" : "warning",
      message:
        unsafeConfigKeyCount === 0
          ? "Configuration shape is safe for silent validation."
          : "Configuration contains fields that should be removed from source metadata."
    }
  ];

  return {
    sourceId: source.id,
    status: aggregateStatus(checks),
    mode: "silent",
    writesPerformed: false,
    checkedAt,
    checks
  };
}
