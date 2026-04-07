import type { Prisma, Severity } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

function asObject(value: Prisma.JsonValue): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function computeSlaDueAt(startedAt: Date, severity: Severity): Date {
  const minutesBySeverity: Record<Severity, number> = {
    warn: 240,
    low: 180,
    medium: 120,
    high: 60,
    critical: 15
  };

  const due = new Date(startedAt);
  due.setMinutes(due.getMinutes() + minutesBySeverity[severity]);
  return due;
}

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

export async function openOrRefreshBridgeIncident(input: {
  tenantId: string;
  incidentId?: string | null;
  severity: Severity;
  summary: string;
  fingerprint: string;
  details: Record<string, unknown>;
  lastSeenAt: Date;
}) {
  const now = new Date();

  const existing = input.incidentId
    ? await prisma.incident.findFirst({
        where: {
          id: input.incidentId,
          tenant_id: input.tenantId
        }
      })
    : await prisma.incident.findFirst({
        where: {
          tenant_id: input.tenantId,
          fingerprint: input.fingerprint
        },
        orderBy: {
          started_at: "desc"
        }
      });

  if (!existing) {
    const created = await prisma.incident.create({
      data: {
        tenant_id: input.tenantId,
        status: "open",
        severity: input.severity,
        started_at: now,
        last_seen_at: input.lastSeenAt,
        sla_due_at: computeSlaDueAt(now, input.severity),
        fingerprint: input.fingerprint,
        summary: input.summary,
        details_json: input.details as Prisma.InputJsonValue
      }
    });

    await prisma.incidentEvent.createMany({
      data: [
        {
          incident_id: created.id,
          event_type: "BRIDGE_OPENED",
          payload_json: {
            source: "operational_finding_bridge",
            at: now.toISOString()
          }
        },
        {
          incident_id: created.id,
          event_type: "ALERT_PENDING",
          payload_json: {
            source: "operational_finding_bridge",
            reason: "bridge_opened",
            at: now.toISOString()
          }
        }
      ]
    });

    return {
      incident: created,
      action: "created" as const
    };
  }

  const reopened = existing.status === "resolved";
  const startedAt = reopened ? now : existing.started_at;
  const updated = await prisma.incident.update({
    where: { id: existing.id },
    data: {
      status: "open",
      severity: input.severity,
      resolved_at: null,
      started_at: startedAt,
      last_seen_at: input.lastSeenAt,
      sla_due_at: computeSlaDueAt(startedAt, input.severity),
      summary: input.summary,
      fingerprint: input.fingerprint,
      details_json: input.details as Prisma.InputJsonValue
    }
  });

  if (reopened) {
    await prisma.incidentEvent.createMany({
      data: [
        {
          incident_id: existing.id,
          event_type: "BRIDGE_REOPENED",
          payload_json: {
            source: "operational_finding_bridge",
            at: now.toISOString()
          }
        },
        {
          incident_id: existing.id,
          event_type: "ALERT_PENDING",
          payload_json: {
            source: "operational_finding_bridge",
            reason: "bridge_reopened",
            at: now.toISOString()
          }
        }
      ]
    });
  } else {
    await prisma.incidentEvent.create({
      data: {
        incident_id: existing.id,
        event_type: "BRIDGE_REFRESHED",
        payload_json: {
          source: "operational_finding_bridge",
          at: now.toISOString()
        }
      }
    });
  }

  return {
    incident: updated,
    action: reopened ? ("reopened" as const) : ("updated" as const)
  };
}

export async function resolveBridgeIncident(input: {
  tenantId: string;
  incidentId: string;
  resolvedAt: Date;
  reason: string;
}) {
  const incident = await prisma.incident.findFirst({
    where: {
      id: input.incidentId,
      tenant_id: input.tenantId
    }
  });

  if (!incident || incident.status === "resolved") {
    return {
      resolved: false
    };
  }

  await prisma.incident.update({
    where: { id: incident.id },
    data: {
      status: "resolved",
      resolved_at: input.resolvedAt,
      details_json: {
        ...asObject(incident.details_json),
        resolved_by: "operational_finding_bridge",
        bridge_resolution_reason: input.reason
      }
    }
  });

  await prisma.incidentEvent.create({
    data: {
      incident_id: incident.id,
      event_type: "BRIDGE_RESOLVED",
      payload_json: {
        source: "operational_finding_bridge",
        reason: input.reason,
        at: input.resolvedAt.toISOString()
      }
    }
  });

  return {
    resolved: true
  };
}
