import { prisma } from "../lib/prisma.js";

export type CanonicalSourceKind = "workflow" | "github_integration" | "custom_ingestion";
export type CanonicalSourceStatus = "active" | "inactive";

export type CanonicalSource = {
  id: string;
  tenantId: string;
  kind: CanonicalSourceKind;
  status: CanonicalSourceStatus;
  displayName: string;
  externalRef: string | null;
  configRef: string | null;
  lastActivityAt: Date | null;
  connectedAt: Date;
  countsTowardCapacity: boolean;
  details: Record<string, unknown>;
};

type WorkflowSourceRow = {
  id: string;
  tenant_id: string;
  display_name: string;
  slug: string;
  system: string;
  environment: string;
  source_type?: string;
  is_active: boolean;
  created_at: Date;
};

type GitHubIntegrationSourceRow = {
  id: string;
  tenant_id: string;
  repository_full_name: string | null;
  webhook_id: string;
  is_active: boolean;
  last_seen_at: Date | null;
  created_at: Date;
};

type ApiKeySourceRow = {
  id: string;
  tenant_id: string;
  name: string;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
};

type SourceClient = {
  workflow: {
    findMany: (args: Record<string, unknown>) => Promise<WorkflowSourceRow[]>;
  };
  gitHubIntegration: {
    findMany: (args: Record<string, unknown>) => Promise<GitHubIntegrationSourceRow[]>;
  };
  apiKey: {
    findMany: (args: Record<string, unknown>) => Promise<ApiKeySourceRow[]>;
  };
};

function normalizeWorkflowSource(row: WorkflowSourceRow): CanonicalSource {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    kind: "workflow",
    status: row.is_active ? "active" : "inactive",
    displayName: row.display_name,
    externalRef: row.slug,
    configRef: null,
    lastActivityAt: null,
    connectedAt: row.created_at,
    countsTowardCapacity: true,
    details: {
      slug: row.slug,
      system: row.system,
      environment: row.environment,
      source_type: row.source_type ?? "workflow"
    }
  };
}

function normalizeGitHubIntegrationSource(row: GitHubIntegrationSourceRow): CanonicalSource {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    kind: "github_integration",
    status: row.is_active ? "active" : "inactive",
    displayName: row.repository_full_name ?? `hook:${row.webhook_id}`,
    externalRef: row.repository_full_name,
    configRef: row.webhook_id,
    lastActivityAt: row.last_seen_at,
    connectedAt: row.created_at,
    countsTowardCapacity: true,
    details: {
      webhook_id: row.webhook_id,
      repository_full_name: row.repository_full_name
    }
  };
}

function normalizeCustomIngestionSource(row: ApiKeySourceRow): CanonicalSource {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    kind: "custom_ingestion",
    status: row.revoked_at ? "inactive" : "active",
    displayName: row.name,
    externalRef: null,
    configRef: null,
    lastActivityAt: row.last_used_at,
    connectedAt: row.created_at,
    countsTowardCapacity: false,
    details: {}
  };
}

export async function listCanonicalSourcesForTenant(input: {
  tenantId: string;
  client?: SourceClient;
  includeInactiveWorkflows?: boolean;
  includeCustomIngestion?: boolean;
}): Promise<CanonicalSource[]> {
  const client = input.client ?? (prisma as unknown as SourceClient);
  const includeInactiveWorkflows = input.includeInactiveWorkflows ?? false;
  const includeCustomIngestion = input.includeCustomIngestion ?? true;

  const [workflows, githubIntegrations, apiKeys] = await Promise.all([
    client.workflow.findMany({
      where: {
        tenant_id: input.tenantId,
        ...(includeInactiveWorkflows ? {} : { is_active: true })
      },
      select: {
        id: true,
        tenant_id: true,
        display_name: true,
        slug: true,
        system: true,
        environment: true,
        source_type: true,
        is_active: true,
        created_at: true
      },
      orderBy: {
        created_at: "desc"
      }
    }),
    client.gitHubIntegration.findMany({
      where: {
        tenant_id: input.tenantId
      },
      select: {
        id: true,
        tenant_id: true,
        repository_full_name: true,
        webhook_id: true,
        is_active: true,
        last_seen_at: true,
        created_at: true
      },
      orderBy: {
        created_at: "desc"
      }
    }),
    includeCustomIngestion
      ? client.apiKey.findMany({
          where: {
            tenant_id: input.tenantId,
            revoked_at: null
          },
          select: {
            id: true,
            tenant_id: true,
            name: true,
            created_at: true,
            last_used_at: true,
            revoked_at: true
          },
          orderBy: {
            created_at: "desc"
          }
        })
      : Promise.resolve([])
  ]);

  return [
    ...workflows.map(normalizeWorkflowSource),
    ...githubIntegrations.map(normalizeGitHubIntegrationSource),
    ...apiKeys.map(normalizeCustomIngestionSource)
  ];
}

export async function countCapacitySourcesForTenant(input: { tenantId: string; client?: SourceClient }): Promise<number> {
  const sources = await listCanonicalSourcesForTenant({
    tenantId: input.tenantId,
    client: input.client,
    includeCustomIngestion: false
  });

  return sources.filter((source) => source.countsTowardCapacity && source.status === "active").length;
}

export function summarizeCanonicalSources(sources: CanonicalSource[]) {
  return {
    workflow_sources: sources.filter((source) => source.kind === "workflow" && source.status === "active").length,
    github_sources: sources.filter((source) => source.kind === "github_integration" && source.status === "active").length,
    ingestion_keys_active: sources.filter((source) => source.kind === "custom_ingestion" && source.status === "active").length
  };
}
