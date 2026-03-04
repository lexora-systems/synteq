import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "../src/utils/crypto.js";

const txRefreshFindUnique = vi.fn();
const txRefreshUpdateMany = vi.fn();
const txRefreshCreate = vi.fn();
const txSecurityCreate = vi.fn();
const prismaTransaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
  callback({
    refreshToken: {
      findUnique: txRefreshFindUnique,
      updateMany: txRefreshUpdateMany,
      create: txRefreshCreate
    },
    securityEvent: {
      create: txSecurityCreate
    }
  })
);

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    $transaction: prismaTransaction
  }
}));

vi.mock("../src/config.js", () => ({
  config: {
    ACCESS_TOKEN_TTL: "15m",
    REFRESH_TOKEN_TTL: "30d"
  }
}));

describe("refresh reuse detection", () => {
  beforeEach(() => {
    txRefreshFindUnique.mockReset();
    txRefreshUpdateMany.mockReset();
    txRefreshCreate.mockReset();
    txSecurityCreate.mockReset();
    prismaTransaction.mockClear();
  });

  it("rotates refresh token successfully", async () => {
    const { rotateRefreshToken } = await import("../src/services/auth-service.js");
    const reply = {
      jwtSign: vi.fn().mockResolvedValue("access-token")
    } as unknown as { jwtSign: (payload: object, options: object) => Promise<string> };

    txRefreshFindUnique.mockResolvedValue({
      id: "rt-1",
      user_id: "user-1",
      token_hash: sha256("raw-refresh-token"),
      expires_at: new Date(Date.now() + 60_000),
      revoked_at: null,
      user: {
        id: "user-1",
        tenant_id: "tenant-1",
        email: "owner@synteq.local",
        full_name: "Owner User",
        role: "owner",
        email_verified_at: null,
        disabled_at: null
      }
    });
    txRefreshUpdateMany.mockResolvedValue({ count: 1 });
    txRefreshCreate.mockResolvedValue({});

    const result = await rotateRefreshToken(reply as never, "raw-refresh-token", {
      ip: "127.0.0.1",
      userAgent: "vitest"
    });

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.access_token).toBe("access-token");
      expect(result.refresh_token.length).toBeGreaterThan(20);
    }

    expect(txRefreshUpdateMany).toHaveBeenCalledTimes(1);
    expect(txSecurityCreate).not.toHaveBeenCalled();
  });

  it("detects reuse and revokes all user sessions", async () => {
    const { rotateRefreshToken } = await import("../src/services/auth-service.js");
    const reply = {
      jwtSign: vi.fn().mockResolvedValue("access-token")
    } as unknown as { jwtSign: (payload: object, options: object) => Promise<string> };

    txRefreshFindUnique.mockResolvedValue({
      id: "rt-old",
      user_id: "user-1",
      token_hash: sha256("old-token"),
      expires_at: new Date(Date.now() + 60_000),
      revoked_at: new Date(),
      user: {
        id: "user-1",
        tenant_id: "tenant-1",
        email: "owner@synteq.local",
        full_name: "Owner User",
        role: "owner",
        email_verified_at: null,
        disabled_at: null
      }
    });
    txRefreshUpdateMany.mockResolvedValue({ count: 3 });
    txRefreshCreate.mockResolvedValue({});

    const result = await rotateRefreshToken(reply as never, "old-token", {
      ip: "127.0.0.1",
      userAgent: "vitest"
    });

    expect(result.status).toBe("reuse_detected");
    expect(txRefreshUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id: "user-1",
          revoked_at: null
        })
      })
    );
    expect(txSecurityCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "REFRESH_REUSE_DETECTED"
        })
      })
    );
  });
});
