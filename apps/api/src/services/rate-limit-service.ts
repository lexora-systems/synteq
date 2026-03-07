import { redisIncrWithTtl, redisKey } from "../lib/redis.js";

export type RateLimitResult = {
  allowed: boolean;
  current: number;
  retryAfterSec: number;
};

function normalizeKey(input: string) {
  return input.replace(/[^a-zA-Z0-9:_\-\.]/g, "_");
}

export async function consumeRateLimit(input: {
  scope: string;
  key: string;
  max: number;
  windowSec: number;
}): Promise<RateLimitResult> {
  const counterKey = redisKey("ratelimit", normalizeKey(input.scope), normalizeKey(input.key));
  const counter = await redisIncrWithTtl(counterKey, input.windowSec);
  return {
    allowed: counter.count <= input.max,
    current: counter.count,
    retryAfterSec: Math.max(1, counter.ttlSec)
  };
}
