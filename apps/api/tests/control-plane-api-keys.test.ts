import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiKeyFindManyMock = vi.fn();
const apiKeyCreateMock = vi.fn();
const apiKeyFindFirstMock = vi.fn();
const apiKeyUpdateMock = vi.fn();
const prismaTransactionMock = vi.fn();

vi.mock("../src/config.js", () => ({
  config: {
    SYNTEQ_API_KEY_SALT: "test-salt-value-with-minimum-length-123456789"
  }
}));

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    apiKey: {
      findMany: apiKeyFindManyMock,
      create: apiKeyCreateMock,
      findFirst: apiKeyFindFirstMock,
      update: apiKeyUpdateMock
    },
    $transaction: prismaTransactionMock
  }
}));

describe("control plane api keys routes", () => {
  let app: ReturnType<typeof Fastify>;
  let role: "owner" | "admin" | "engineer" | "viewer";

  beforeEach(async () => {
    role = "owner";
    apiKeyFindManyMock.mockReset();
    apiKeyCreateMock.mockReset();
    apiKeyFindFirstMock.mockReset();
    apiKeyUpdateMock.mockReset();
    prismaTransactionMock.mockReset();

    apiKeyFindManyMock.mockResolvedValue([
      {
        id: "key-1",
        name: "Primary Ingest",
        key_hash: "abcdef0123456789",
        created_at: new Date("2026-03-31T01:00:00.000Z"),
        last_used_at: null,
        revoked_at: null
      }
    ]);
    apiKeyCreateMock.mockResolvedValue({
      id: "key-2",
      name: "Secondary Ingest",
      key_hash: "a1b2c3d4e5f60789",
      created_at: new Date("2026-03-31T02:00:00.000Z"),
      last_used_at: null,
      revoked_at: null
    });
    apiKeyFindFirstMock.mockResolvedValue({
      id: "key-1",
      name: "Primary Ingest",
      revoked_at: null
    });
    apiKeyUpdateMock.mockResolvedValue({});
    prismaTransactionMock.mockImplementation(async (callback: (tx: { apiKey: { update: typeof apiKeyUpdateMock; create: typeof apiKeyCreateMock } }) => Promise<unknown>) =>
      callback({
        apiKey: {
          update: apiKeyUpdateMock,
          create: apiKeyCreateMock
        }
      })
    );

    app = Fastify();
    app.decorate("requireDashboardAuth", async (request: any) => {
      request.authUser = {
        user_id: "owner-1",
        email: "owner@synteq.local",
        full_name: "Owner",
        tenant_id: "tenant-A",
        role,
        email_verified_at: null
      };
    });
    app.decorate("requireRoles", () => async () => undefined);
    app.decorate("requireIngestionKey", async () => undefined);
    app.decorate("requireIngestionSignature", async () => undefined);
    app.decorate("requirePermissions", (permissions: string[]) => {
      return async (request: any, reply: any) => {
        if (!request.authUser) {
          return reply.code(401).send({ error: "Unauthorized" });
        }
        if (permissions.includes("SETTINGS_MANAGE") && !["owner", "admin"].includes(request.authUser.role)) {
          return reply.code(403).send({ error: "Forbidden", code: "FORBIDDEN_PERMISSION" });
        }
      };
    });

    const routes = (await import("../src/routes/control-plane.js")).default;
    await app.register(routes, { prefix: "/v1" });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("lists masked api keys for tenant", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/control-plane/api-keys"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      api_keys: [
        {
          id: "key-1",
          name: "Primary Ingest",
          key_preview: "synteq_****456789"
        }
      ]
    });
    expect(apiKeyFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenant_id: "tenant-A"
        })
      })
    );
  });

  it("creates an api key and returns one-time secret", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/control-plane/api-keys",
      payload: {
        name: "Secondary Ingest"
      }
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.api_key).toMatchObject({
      id: "key-2",
      name: "Secondary Ingest"
    });
    expect(typeof body.secret).toBe("string");
    expect(body.secret.startsWith("synteq_")).toBe(true);
    expect(apiKeyCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenant_id: "tenant-A",
          name: "Secondary Ingest"
        })
      })
    );
  });

  it("rejects settings mutations for viewer", async () => {
    role = "viewer";
    const response = await app.inject({
      method: "POST",
      url: "/v1/control-plane/api-keys",
      payload: {
        name: "Blocked"
      }
    });

    expect(response.statusCode).toBe(403);
    expect(apiKeyCreateMock).not.toHaveBeenCalled();
  });

  it("scopes revoke to current tenant", async () => {
    apiKeyFindFirstMock.mockResolvedValueOnce(null);

    const response = await app.inject({
      method: "POST",
      url: "/v1/control-plane/api-keys/key-other/revoke"
    });

    expect(response.statusCode).toBe(404);
    expect(apiKeyUpdateMock).not.toHaveBeenCalled();
  });
});
