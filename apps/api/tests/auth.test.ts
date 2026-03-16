import { describe, expect, it } from "vitest";
import { loginSchema, refreshTokenSchema } from "@synteq/shared";
import { hashPassword, verifyPassword } from "../src/utils/password.js";
import { parseDurationToMs } from "../src/utils/duration.js";

describe("auth", () => {
  it("hashes and verifies password for login flow", async () => {
    const password = "Sup3rSecurePass!";
    const hash = await hashPassword(password);

    expect(hash).not.toBe(password);
    expect(await verifyPassword(password, hash)).toBe(true);
    expect(await verifyPassword("bad-password", hash)).toBe(false);
  });

  it("validates login and refresh payloads", () => {
    const login = loginSchema.safeParse({
      tenant_id: "tenant-1",
      email: "owner@synteq.local",
      password: "LongEnough123!"
    });
    const refresh = refreshTokenSchema.safeParse({
      refresh_token: "x".repeat(48)
    });

    expect(login.success).toBe(true);
    expect(refresh.success).toBe(true);
  });

  it("parses access and refresh ttl settings", () => {
    expect(parseDurationToMs("15m")).toBe(15 * 60 * 1000);
    expect(parseDurationToMs("30d")).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
