import type { FastifyPluginAsync } from "fastify";
import type { Prisma } from "@prisma/client";
import { securityEventsQuerySchema } from "@synteq/shared";
import { parseWithSchema } from "../utils/validation.js";
import { prisma } from "../lib/prisma.js";

const securityEventsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/security-events",
    {
      preHandler: [app.requireDashboardAuth, app.requireRoles(["owner", "admin"])]
    },
    async (request, reply) => {
      const authUser = request.authUser;
      if (!authUser?.tenant_id) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const query = parseWithSchema(securityEventsQuerySchema, request.query);
      const where: Prisma.SecurityEventWhereInput = {
        tenant_id: authUser.tenant_id
      };

      if (query.type) {
        where.type = query.type;
      }

      if (query.from || query.to) {
        where.created_at = {
          gte: query.from,
          lte: query.to
        };
      }

      const [total, events] = await Promise.all([
        prisma.securityEvent.count({ where }),
        prisma.securityEvent.findMany({
          where,
          orderBy: {
            created_at: "desc"
          },
          skip: (query.page - 1) * query.limit,
          take: query.limit
        })
      ]);

      const userIds = [...new Set(events.map((event) => event.user_id).filter((value): value is string => Boolean(value)))];
      const users =
        userIds.length > 0
          ? await prisma.user.findMany({
              where: {
                tenant_id: authUser.tenant_id,
                id: {
                  in: userIds
                }
              },
              select: {
                id: true,
                email: true,
                full_name: true
              }
            })
          : [];

      const usersById = new Map(users.map((user) => [user.id, user]));
      return {
        events: events.map((event) => ({
          id: event.id,
          type: event.type,
          created_at: event.created_at,
          ip: event.ip,
          user_agent: event.user_agent,
          metadata_json: event.metadata_json,
          actor: event.user_id ? usersById.get(event.user_id) ?? null : null
        })),
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          has_next: query.page * query.limit < total
        },
        request_id: request.id
      };
    }
  );
};

export default securityEventsRoutes;
