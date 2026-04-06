import { prisma } from "../lib/prisma.js";

type OwnershipClient = {
  workflow: {
    findFirst: (args: Record<string, unknown>) => Promise<{ id: string } | null>;
  };
  gitHubIntegration: {
    count: (args: Record<string, unknown>) => Promise<number>;
  };
};

export type OperationalSourceOwner =
  | {
      kind: "api_key";
      apiKeyId: string | null;
    }
  | {
      kind: "github_integration";
      integrationId: string;
    };

export class IngestSourceOwnershipError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(input: {
    message: string;
    code: string;
    statusCode?: number;
    details?: Record<string, unknown>;
  }) {
    super(input.message);
    this.name = "IngestSourceOwnershipError";
    this.code = input.code;
    this.statusCode = input.statusCode ?? 403;
    this.details = input.details;
  }
}

export function isIngestSourceOwnershipError(error: unknown): error is IngestSourceOwnershipError {
  return error instanceof IngestSourceOwnershipError;
}

export async function assertWorkflowSourceOwnership(input: {
  tenantId: string;
  workflowId: string;
  client?: OwnershipClient;
}): Promise<void> {
  const client = input.client ?? (prisma as unknown as OwnershipClient);
  const workflow = await client.workflow.findFirst({
    where: {
      id: input.workflowId,
      tenant_id: input.tenantId,
      is_active: true
    },
    select: {
      id: true
    }
  });

  if (workflow) {
    return;
  }

  throw new IngestSourceOwnershipError({
    message: "Workflow source is not registered for this tenant",
    code: "INGEST_SOURCE_UNREGISTERED",
    details: {
      tenant_id: input.tenantId,
      workflow_id: input.workflowId
    }
  });
}

export async function assertOperationalSourceOwnership(input: {
  tenantId: string;
  sourceValues: string[];
  owner: OperationalSourceOwner;
  client?: OwnershipClient;
}): Promise<void> {
  const client = input.client ?? (prisma as unknown as OwnershipClient);
  const sources = [...new Set(input.sourceValues.map((value) => value.trim().toLowerCase()).filter(Boolean))];

  if (sources.length === 0) {
    throw new IngestSourceOwnershipError({
      message: "Operational event source is required",
      code: "INGEST_SOURCE_UNREGISTERED",
      details: {
        tenant_id: input.tenantId
      }
    });
  }

  if (input.owner.kind === "github_integration") {
    const disallowed = sources.filter((source) => source !== "github_actions");
    if (disallowed.length === 0) {
      return;
    }

    throw new IngestSourceOwnershipError({
      message: "GitHub integration ingestion only accepts github_actions source events",
      code: "INGEST_SOURCE_OWNER_MISMATCH",
      details: {
        tenant_id: input.tenantId,
        owner_kind: input.owner.kind,
        disallowed_sources: disallowed
      }
    });
  }

  if (!sources.includes("github_actions")) {
    return;
  }

  const activeGitHubSources = await client.gitHubIntegration.count({
    where: {
      tenant_id: input.tenantId,
      is_active: true
    }
  });

  if (activeGitHubSources > 0) {
    return;
  }

  throw new IngestSourceOwnershipError({
    message: "github_actions source requires an active GitHub integration for this tenant",
    code: "INGEST_SOURCE_UNREGISTERED",
    details: {
      tenant_id: input.tenantId,
      owner_kind: input.owner.kind
    }
  });
}
