import { describe, expect, it } from "vitest";
import { inviteAcceptSchema, inviteCreateSchema } from "@synteq/shared";
import { randomOpaqueToken, sha256 } from "../src/utils/crypto.js";

describe("invite flow", () => {
  it("validates owner/admin invite payload", () => {
    const parsed = inviteCreateSchema.safeParse({
      email: "new.user@company.com",
      role: "engineer"
    });

    expect(parsed.success).toBe(true);
  });

  it("validates invite acceptance payload", () => {
    const parsed = inviteAcceptSchema.safeParse({
      full_name: "New User",
      password: "StrongPass123!"
    });

    expect(parsed.success).toBe(true);
  });

  it("stores hashed invite token instead of raw token", () => {
    const rawToken = randomOpaqueToken(48);
    const hashed = sha256(rawToken);

    expect(rawToken).not.toBe(hashed);
    expect(hashed).toHaveLength(64);
  });
});
