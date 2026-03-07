import { createClient } from "redis";
import { config } from "../config.js";

type RedisCounterResult = {
  count: number;
  ttlSec: number;
};

type FallbackEntry = {
  value: string;
  expiresAt: number | null;
};

const fallbackStore = new Map<string, FallbackEntry>();

type SynteqRedisClient = ReturnType<typeof createClient>;

let client: SynteqRedisClient | null = null;
let connectPromise: Promise<SynteqRedisClient | null> | null = null;
let nextConnectAttemptAt = 0;
let warnedFallback = false;

function fallbackAllowed() {
  return !config.REDIS_REQUIRED;
}

function prefixed(key: string) {
  return `${config.REDIS_KEY_PREFIX}:${key}`;
}

function nowMs() {
  return Date.now();
}

function getFallbackEntry(key: string): FallbackEntry | null {
  const entry = fallbackStore.get(key);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt !== null && entry.expiresAt <= nowMs()) {
    fallbackStore.delete(key);
    return null;
  }

  return entry;
}

function fallbackGet(key: string): string | null {
  return getFallbackEntry(key)?.value ?? null;
}

function fallbackSet(key: string, value: string, ttlSec?: number) {
  const expiresAt = typeof ttlSec === "number" ? nowMs() + ttlSec * 1000 : null;
  fallbackStore.set(key, { value, expiresAt });
}

function fallbackSetNx(key: string, value: string, ttlSec: number): boolean {
  if (getFallbackEntry(key)) {
    return false;
  }

  fallbackSet(key, value, ttlSec);
  return true;
}

function fallbackDelete(key: string): number {
  if (!fallbackStore.has(key)) {
    return 0;
  }

  fallbackStore.delete(key);
  return 1;
}

function fallbackTtl(key: string): number {
  const entry = getFallbackEntry(key);
  if (!entry) {
    return -2;
  }

  if (entry.expiresAt === null) {
    return -1;
  }

  return Math.max(0, Math.ceil((entry.expiresAt - nowMs()) / 1000));
}

function fallbackIncrWithTtl(key: string, ttlSec: number): RedisCounterResult {
  const entry = getFallbackEntry(key);
  const current = entry ? Number(entry.value) || 0 : 0;
  const next = current + 1;

  if (!entry) {
    fallbackSet(key, String(next), ttlSec);
    return { count: next, ttlSec };
  }

  fallbackSet(key, String(next), entry.expiresAt ? Math.max(1, Math.ceil((entry.expiresAt - nowMs()) / 1000)) : ttlSec);
  return {
    count: next,
    ttlSec: Math.max(1, fallbackTtl(key))
  };
}

function warnFallback(error: unknown) {
  if (warnedFallback) {
    return;
  }

  warnedFallback = true;
  const message = error instanceof Error ? error.message : "unknown redis error";
  console.warn(`[redis] falling back to local memory state: ${message}`);
}

async function connectRedis(): Promise<SynteqRedisClient | null> {
  if (!config.REDIS_URL) {
    return null;
  }

  if (client?.isOpen) {
    return client;
  }

  if (connectPromise) {
    return connectPromise;
  }

  const now = nowMs();
  if (now < nextConnectAttemptAt) {
    return null;
  }

  const nextClient = createClient({
    url: config.REDIS_URL
  });

  nextClient.on("error", (error) => {
    if (config.REDIS_REQUIRED) {
      console.error("[redis] client error", error);
      return;
    }

    warnFallback(error);
  });

  connectPromise = nextClient
    .connect()
    .then(() => {
      client = nextClient;
      warnedFallback = false;
      return nextClient;
    })
    .catch((error) => {
      client = null;
      nextConnectAttemptAt = nowMs() + 5000;
      if (config.REDIS_REQUIRED) {
        throw error;
      }

      warnFallback(error);
      return null;
    })
    .finally(() => {
      connectPromise = null;
    });

  return connectPromise;
}

async function withRedis<T>(
  operation: (redisClient: SynteqRedisClient) => Promise<T>,
  fallbackOperation: () => T | Promise<T>
): Promise<T> {
  const redisClient = await connectRedis();
  if (!redisClient) {
    if (!fallbackAllowed()) {
      throw new Error("Redis is unavailable and REDIS_REQUIRED=true");
    }

    return fallbackOperation();
  }

  try {
    return await operation(redisClient);
  } catch (error) {
    if (!fallbackAllowed()) {
      throw error;
    }

    warnFallback(error);
    return fallbackOperation();
  }
}

export function redisKey(...parts: Array<string | number>) {
  return prefixed(parts.map((part) => String(part)).join(":"));
}

export async function redisGet(key: string): Promise<string | null> {
  return withRedis(
    async (redisClient) => redisClient.get(key),
    () => fallbackGet(key)
  );
}

export async function redisGetJson<T>(key: string): Promise<T | null> {
  const raw = await redisGet(key);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function redisSet(key: string, value: string, ttlSec?: number): Promise<void> {
  await withRedis(
    async (redisClient) => {
      if (typeof ttlSec === "number") {
        await redisClient.set(key, value, { EX: ttlSec });
      } else {
        await redisClient.set(key, value);
      }
    },
    () => {
      fallbackSet(key, value, ttlSec);
    }
  );
}

export async function redisSetJson(key: string, value: unknown, ttlSec?: number): Promise<void> {
  await redisSet(key, JSON.stringify(value), ttlSec);
}

export async function redisSetNx(key: string, value: string, ttlSec: number): Promise<boolean> {
  return withRedis(
    async (redisClient) => {
      const result = await redisClient.set(key, value, { EX: ttlSec, NX: true });
      return result === "OK";
    },
    () => fallbackSetNx(key, value, ttlSec)
  );
}

export async function redisDelete(key: string): Promise<number> {
  return withRedis(
    async (redisClient) => redisClient.del(key),
    () => fallbackDelete(key)
  );
}

export async function redisTtl(key: string): Promise<number> {
  return withRedis(
    async (redisClient) => redisClient.ttl(key),
    () => fallbackTtl(key)
  );
}

export async function redisIncrWithTtl(key: string, ttlSec: number): Promise<RedisCounterResult> {
  return withRedis(
    async (redisClient) => {
      const nextCount = await redisClient.incr(key);
      if (nextCount === 1) {
        await redisClient.expire(key, ttlSec);
      } else {
        const existingTtl = await redisClient.ttl(key);
        if (existingTtl < 0) {
          await redisClient.expire(key, ttlSec);
        }
      }

      const nextTtl = await redisClient.ttl(key);
      return {
        count: nextCount,
        ttlSec: nextTtl > 0 ? nextTtl : ttlSec
      };
    },
    () => fallbackIncrWithTtl(key, ttlSec)
  );
}
