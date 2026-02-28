import type { FastifyPluginAsync } from "fastify";
import { loginSchema } from "@synteq/shared";
import { parseWithSchema } from "../utils/validation.js";
import { config } from "../config.js";
import { prisma } from "../lib/prisma.js";

const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/auth/login", async (request, reply) => {
    const body = parseWithSchema(loginSchema, request.body);

    if (body.email !== config.DASHBOARD_ADMIN_EMAIL || body.password !== config.DASHBOARD_ADMIN_PASSWORD) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    const user = await prisma.user.findFirst({
      where: {
        email: body.email,
        is_active: true
      },
      orderBy: {
        created_at: "asc"
      }
    });

    const tenantId = user?.tenant_id ?? config.DEFAULT_TENANT_ID;
    if (!tenantId) {
      return reply.code(500).send({ error: "Missing tenant context. Seed the database first." });
    }

    const token = await reply.jwtSign(
      {
        email: body.email,
        tenant_id: tenantId,
        role: user?.role ?? "admin"
      },
      {
        expiresIn: "12h"
      }
    );

    return {
      token,
      user: {
        email: body.email,
        tenant_id: tenantId,
        role: user?.role ?? "admin"
      }
    };
  });

  app.get(
    "/auth/me",
    {
      preHandler: app.requireDashboardAuth
    },
    async (request) => {
      return {
        user: request.authUser
      };
    }
  );
};

export default authRoutes;
