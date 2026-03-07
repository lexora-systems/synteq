import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, { value: string; expiresAt: number | null }>();

function ttl(entry: { expiresAt: number | null }) {
  if (entry.expiresAt === null) {
    return -1;
  }

  return Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
}

function getEntry(key: string) {
  const entry = store.get(key);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }

  return entry;
}

vi.mock("../src/config.js", () => ({
  config: {
    AUTH_LOGIN_MAX_ATTEMPTS_PER_IP: 3,
    AUTH_LOGIN_MAX_ATTEMPTS_PER_EMAIL: 2,
    AUTH_LOGIN_WINDOW_SEC: 900,
    AUTH_LOGIN_LOCKOUT_SEC: 900
  }
}));

vi.mock("../src/lib/redis.js", () => ({
  redisKey: (...parts: Array<string | number>) => parts.join(":"),
  redisGet: async (key: string) => getEntry(key)?.value ?? null,
  redisSet: async (key: string, value: string, ttlSec?: number) => {
    store.set(key, {
      value,
      expiresAt: typeof ttlSec === "number" ? Date.now() + ttlSec * 1000 : null
    });
  },
  redisDelete: async (key: string) => {
    const existed = store.has(key);
    store.delete(key);
    return existed ? 1 : 0;
  },
  redisTtl: async (key: string) => {
    const entry = getEntry(key);
    if (!entry) {
      return -2;
    }

    return ttl(entry);
  },
  redisIncrWithTtl: async (key: string, ttlSec: number) => {
    const entry = getEntry(key);
    const count = (entry ? Number(entry.value) : 0) + 1;
    if (!entry) {
      store.set(key, {
        value: String(count),
        expiresAt: Date.now() + ttlSec * 1000
      });
      return { count, ttlSec };
    }

    store.set(key, {
      value: String(count),
      expiresAt: entry.expiresAt
    });
    return { count, ttlSec: Math.max(1, ttl(store.get(key)!)) };
  }
}));

describe("redis auth login abuse protection", () => {
  beforeEach(() => {
    store.clear();
    vi.resetModules();
  });

  it("increments failed attempts and applies lockout after threshold", async () => {
    const { recordFailedLoginAttempt, getLoginLockState } = await import("../src/services/auth-abuse-service.js");

    const first = await recordFailedLoginAttempt("127.0.0.1", "owner@synteq.local");
    expect(first.locked).toBe(false);
    expect(first.ipAttempts).toBe(1);
    expect(first.emailAttempts).toBe(1);

    const second = await recordFailedLoginAttempt("127.0.0.1", "owner@synteq.local");
    expect(second.locked).toBe(true);
    expect(second.emailAttempts).toBe(2);

    const lockState = await getLoginLockState("127.0.0.1", "owner@synteq.local");
    expect(lockState.locked).toBe(true);
    expect(lockState.retryAfterSec).toBeGreaterThan(0);
  });

  it("resets counters and lock keys after successful login state reset", async () => {
    const { recordFailedLoginAttempt, getLoginLockState, resetLoginAbuseState } = await import(
      "../src/services/auth-abuse-service.js"
    );

    await recordFailedLoginAttempt("127.0.0.1", "owner@synteq.local");
    await recordFailedLoginAttempt("127.0.0.1", "owner@synteq.local");

    const locked = await getLoginLockState("127.0.0.1", "owner@synteq.local");
    expect(locked.locked).toBe(true);

    await resetLoginAbuseState("127.0.0.1", "owner@synteq.local");

    const unlocked = await getLoginLockState("127.0.0.1", "owner@synteq.local");
    expect(unlocked.locked).toBe(false);
  });
});
