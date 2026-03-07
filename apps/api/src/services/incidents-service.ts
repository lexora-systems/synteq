import { prisma } from "../lib/prisma.js";

export async function listIncidents(params: {
  tenantId: string;
  status?: "open" | "acked" | "resolved";
  workflowId?: string;
  page: number;
  pageSize: number;
}) {
  const where = {
    tenant_id: params.tenantId,
    status: params.status,
    workflow_id: params.workflowId
  };
  const [total, items] = await Promise.all([
    prisma.incident.count({ where }),
    prisma.incident.findMany({
      where,
      orderBy: {
        started_at: "desc"
      },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize
    })
  ]);

  return {
    items,
    total,
    page: params.page,
    page_size: params.pageSize,
    has_next: params.page * params.pageSize < total
  };
}

export async function getIncidentById(tenantId: string, incidentId: string) {
  return prisma.incident.findFirst({
    where: {
      id: incidentId,
      tenant_id: tenantId
    }
  });
}

export async function listIncidentEvents(incidentId: string, limit = 20) {
  return prisma.incidentEvent.findMany({
    where: {
      incident_id: incidentId
    },
    orderBy: {
      at_time: "desc"
    },
    take: limit
  });
}

export async function markBreachedSla(now = new Date()) {
  const openIncidents = await prisma.incident.findMany({
    where: {
      status: {
        in: ["open", "acked"]
      },
      sla_due_at: {
        lte: now
      },
      sla_breached_at: null
    },
    select: {
      id: true
    }
  });

  if (openIncidents.length === 0) {
    return 0;
  }

  await prisma.incident.updateMany({
    where: {
      id: {
        in: openIncidents.map((incident) => incident.id)
      }
    },
    data: {
      sla_breached_at: now
    }
  });

  await prisma.incidentEvent.createMany({
    data: openIncidents.map((incident) => ({
      incident_id: incident.id,
      event_type: "SLA_BREACHED",
      payload_json: {
        at: now.toISOString()
      }
    }))
  });

  return openIncidents.length;
}

export async function ackIncident(tenantId: string, incidentId: string) {
  const incident = await prisma.incident.findFirst({
    where: {
      id: incidentId,
      tenant_id: tenantId
    }
  });

  if (!incident) {
    return null;
  }

  const updated = await prisma.incident.update({
    where: { id: incident.id },
    data: {
      status: "acked"
    }
  });

  await prisma.incidentEvent.create({
    data: {
      incident_id: incident.id,
      event_type: "ACKED",
      payload_json: {
        previous_status: incident.status,
        updated_status: "acked"
      }
    }
  });

  return updated;
}

export async function resolveIncident(tenantId: string, incidentId: string) {
  const incident = await prisma.incident.findFirst({
    where: {
      id: incidentId,
      tenant_id: tenantId
    }
  });

  if (!incident) {
    return null;
  }

  const now = new Date();
  const updated = await prisma.incident.update({
    where: { id: incident.id },
    data: {
      status: "resolved",
      resolved_at: now,
      details_json: {
        ...(incident.details_json as Record<string, unknown>),
        cooldown_hits: 0
      }
    }
  });

  await prisma.incidentEvent.create({
    data: {
      incident_id: incident.id,
      event_type: "RESOLVED_MANUAL",
      payload_json: {
        previous_status: incident.status,
        updated_status: "resolved",
        at: now.toISOString()
      }
    }
  });

  return updated;
}
