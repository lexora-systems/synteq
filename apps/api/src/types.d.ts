import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    tenantId?: string;
    apiKeyId?: string;
    authUser?: {
      email: string;
      tenant_id: string;
      role: string;
    };
    rawBody?: string;
  }

  interface FastifyInstance {
    requireDashboardAuth: (request: FastifyRequest, reply: import("fastify").FastifyReply) => Promise<void>;
    requireIngestionKey: (request: FastifyRequest, reply: import("fastify").FastifyReply) => Promise<void>;
    requireIngestionSignature: (request: FastifyRequest, reply: import("fastify").FastifyReply) => Promise<void>;
  }
}
