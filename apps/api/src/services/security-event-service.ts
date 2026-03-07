import { prisma } from "../lib/prisma.js";
import type { Prisma } from "@prisma/client";

export type SecurityEventType =
  | "REFRESH_REUSE_DETECTED"
  | "LOGIN_FAILED"
  | "LOGIN_LOCKED"
  | "INVITE_RATE_LIMITED";

type SecurityEventInput = {
  tenantId?: string | null;
  userId?: string | null;
  type: SecurityEventType;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
};

export async function logSecurityEvent(input: SecurityEventInput): Promise<void> {
  try {
    await prisma.securityEvent.create({
      data: {
        tenant_id: input.tenantId ?? null,
        user_id: input.userId ?? null,
        type: input.type,
        ip: input.ip ?? null,
        user_agent: input.userAgent ?? null,
        metadata_json: (input.metadata ?? {}) as Prisma.InputJsonValue
      }
    });
  } catch (error) {
    const payload = {
      type: input.type,
      tenant_id: input.tenantId ?? null,
      user_id: input.userId ?? null,
      ip: input.ip ?? null,
      user_agent: input.userAgent ?? null,
      metadata: input.metadata ?? {},
      error: error instanceof Error ? error.message : "unknown_error"
    };

    // If DB logging fails we still want a stable security event payload in logs.
    console.warn(JSON.stringify({ security_event_log_failed: payload }));
  }
}
