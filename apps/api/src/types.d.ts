import "fastify";
import type { UserRole } from "@prisma/client";
import type { Permission } from "./auth/permissions.js";

declare module "fastify" {
  interface FastifyRequest {
    tenantId?: string;
    apiKeyId?: string;
    authUser?: {
      user_id: string;
      email: string;
      full_name: string;
      tenant_id: string;
      role: UserRole;
      email_verified_at: string | null;
    };
    rawBody?: string;
  }

  interface FastifyInstance {
    requireDashboardAuth: (request: FastifyRequest, reply: import("fastify").FastifyReply) => Promise<void>;
    requireRoles: (allowedRoles: UserRole[]) => (request: FastifyRequest, reply: import("fastify").FastifyReply) => Promise<void>;
    requirePermissions: (permissions: Permission[]) => (request: FastifyRequest, reply: import("fastify").FastifyReply) => Promise<void>;
    requireIngestionKey: (request: FastifyRequest, reply: import("fastify").FastifyReply) => Promise<void>;
    requireIngestionSignature: (request: FastifyRequest, reply: import("fastify").FastifyReply) => Promise<void>;
  }
}
