import os from "node:os";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { sanitizeText } from "../utils/sanitize.js";

type WorkerLeaseRow = {
  worker_name: string;
  owner_token: string | null;
  lease_expires_at: Date | null;
  acquired_at: Date | null;
  renewed_at: Date | null;
  last_heartbeat_at: Date | null;
  last_completed_at: Date | null;
};

type WorkerLeaseClient = {
  workerLease: {
    create: (args: Record<string, unknown>) => Promise<unknown>;
    findUnique: (args: Record<string, unknown>) => Promise<WorkerLeaseRow | null>;
    updateMany: (args: Record<string, unknown>) => Promise<{ count: number }>;
    update: (args: Record<string, unknown>) => Promise<unknown>;
  };
};

type LeaseLogger = {
  info: (message: string, payload?: Record<string, unknown>) => void;
  warn: (message: string, payload?: Record<string, unknown>) => void;
  error: (message: string, payload?: Record<string, unknown>) => void;
};

type RunWithLeaseLogger = LeaseLogger;

const defaultLogger: LeaseLogger = {
  info: (message, payload) => console.info(message, payload ?? {}),
  warn: (message, payload) => console.warn(message, payload ?? {}),
  error: (message, payload) => console.error(message, payload ?? {})
};

const DEFAULT_LEASE_DURATION_MS = 90_000;
const DEFAULT_RENEW_INTERVAL_MS = 30_000;

export type WorkerLeaseSettings = {
  leaseDurationMs: number;
  renewIntervalMs: number;
};

function asPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

export function getWorkerLeaseSettings(): WorkerLeaseSettings {
  const leaseDurationMs = asPositiveInt(process.env.WORKER_LEASE_DURATION_MS, DEFAULT_LEASE_DURATION_MS);
  const configuredRenewMs = asPositiveInt(process.env.WORKER_LEASE_RENEW_INTERVAL_MS, DEFAULT_RENEW_INTERVAL_MS);
  const renewIntervalMs = Math.min(configuredRenewMs, Math.max(1_000, Math.floor(leaseDurationMs / 2)));
  return {
    leaseDurationMs,
    renewIntervalMs
  };
}

function computeExpiry(now: Date, leaseDurationMs: number) {
  return new Date(now.getTime() + leaseDurationMs);
}

export function createWorkerLeaseOwnerToken(workerName: string) {
  const safeWorkerName = sanitizeText(workerName, 64) ?? "worker";
  const host = sanitizeText(os.hostname(), 48) ?? "unknown-host";
  return `${safeWorkerName}:${host}:${process.pid}:${randomUUID()}`;
}

export type AcquireWorkerLeaseResult =
  | {
      acquired: true;
      ownerToken: string;
      leaseExpiresAt: Date;
    }
  | {
      acquired: false;
      ownerToken: string;
      leaseExpiresAt: Date | null;
      heldByOwnerToken: string | null;
    };

export async function acquireWorkerLease(input: {
  workerName: string;
  ownerToken: string;
  now?: Date;
  leaseDurationMs?: number;
  client?: WorkerLeaseClient;
}): Promise<AcquireWorkerLeaseResult> {
  const now = input.now ?? new Date();
  const leaseDurationMs = input.leaseDurationMs ?? getWorkerLeaseSettings().leaseDurationMs;
  const leaseExpiresAt = computeExpiry(now, leaseDurationMs);
  const client = input.client ?? (prisma as unknown as WorkerLeaseClient);

  const claimed = await client.workerLease.updateMany({
    where: {
      worker_name: input.workerName,
      OR: [
        {
          lease_expires_at: null
        },
        {
          lease_expires_at: {
            lte: now
          }
        },
        {
          owner_token: input.ownerToken
        }
      ]
    },
    data: {
      owner_token: input.ownerToken,
      lease_expires_at: leaseExpiresAt,
      acquired_at: now,
      renewed_at: now,
      last_heartbeat_at: now
    }
  });

  if (claimed.count > 0) {
    return {
      acquired: true,
      ownerToken: input.ownerToken,
      leaseExpiresAt
    };
  }

  try {
    await client.workerLease.create({
      data: {
        worker_name: input.workerName,
        owner_token: input.ownerToken,
        lease_expires_at: leaseExpiresAt,
        acquired_at: now,
        renewed_at: now,
        last_heartbeat_at: now
      }
    });
    return {
      acquired: true,
      ownerToken: input.ownerToken,
      leaseExpiresAt
    };
  } catch {
    const existing = await client.workerLease.findUnique({
      where: {
        worker_name: input.workerName
      },
      select: {
        owner_token: true,
        lease_expires_at: true,
        worker_name: true,
        acquired_at: true,
        renewed_at: true,
        last_heartbeat_at: true,
        last_completed_at: true
      }
    });
    return {
      acquired: false,
      ownerToken: input.ownerToken,
      leaseExpiresAt: existing?.lease_expires_at ?? null,
      heldByOwnerToken: existing?.owner_token ?? null
    };
  }
}

export async function renewWorkerLease(input: {
  workerName: string;
  ownerToken: string;
  now?: Date;
  leaseDurationMs?: number;
  client?: WorkerLeaseClient;
}) {
  const now = input.now ?? new Date();
  const leaseDurationMs = input.leaseDurationMs ?? getWorkerLeaseSettings().leaseDurationMs;
  const leaseExpiresAt = computeExpiry(now, leaseDurationMs);
  const client = input.client ?? (prisma as unknown as WorkerLeaseClient);
  const renewed = await client.workerLease.updateMany({
    where: {
      worker_name: input.workerName,
      owner_token: input.ownerToken,
      lease_expires_at: {
        gt: now
      }
    },
    data: {
      lease_expires_at: leaseExpiresAt,
      renewed_at: now,
      last_heartbeat_at: now
    }
  });

  return {
    renewed: renewed.count > 0,
    leaseExpiresAt
  };
}

export async function releaseWorkerLease(input: {
  workerName: string;
  ownerToken: string;
  completed: boolean;
  now?: Date;
  client?: WorkerLeaseClient;
}) {
  const now = input.now ?? new Date();
  const client = input.client ?? (prisma as unknown as WorkerLeaseClient);
  const released = await client.workerLease.updateMany({
    where: {
      worker_name: input.workerName,
      owner_token: input.ownerToken
    },
    data: {
      owner_token: null,
      lease_expires_at: null,
      renewed_at: now,
      last_heartbeat_at: now,
      ...(input.completed
        ? {
            last_completed_at: now
          }
        : {})
    }
  });

  return {
    released: released.count > 0
  };
}

type RunWithLeaseInput<T> = {
  workerName: string;
  run: () => Promise<T>;
  ownerToken?: string;
  settings?: Partial<WorkerLeaseSettings>;
  logger?: RunWithLeaseLogger;
  client?: WorkerLeaseClient;
};

type RunWithLeaseResult<T> =
  | {
      skipped: true;
      ownerToken: string;
      leaseExpiresAt: Date | null;
      heldByOwnerToken: string | null;
    }
  | {
      skipped: false;
      ownerToken: string;
      result: T;
    };

export async function runWithWorkerLease<T>(input: RunWithLeaseInput<T>): Promise<RunWithLeaseResult<T>> {
  const logger = input.logger ?? defaultLogger;
  const settings = getWorkerLeaseSettings();
  const leaseDurationMs = input.settings?.leaseDurationMs ?? settings.leaseDurationMs;
  const renewIntervalMs = input.settings?.renewIntervalMs ?? settings.renewIntervalMs;
  const ownerToken = input.ownerToken ?? createWorkerLeaseOwnerToken(input.workerName);
  const client = input.client ?? (prisma as unknown as WorkerLeaseClient);

  const acquired = await acquireWorkerLease({
    workerName: input.workerName,
    ownerToken,
    leaseDurationMs,
    client
  });

  if (!acquired.acquired) {
    logger.info("worker-lease.skipped", {
      worker_name: input.workerName,
      owner_token: ownerToken,
      lease_expires_at: acquired.leaseExpiresAt?.toISOString() ?? null,
      held_by_owner_token: acquired.heldByOwnerToken
    });
    return {
      skipped: true,
      ownerToken,
      leaseExpiresAt: acquired.leaseExpiresAt,
      heldByOwnerToken: acquired.heldByOwnerToken
    };
  }

  logger.info("worker-lease.acquired", {
    worker_name: input.workerName,
    owner_token: ownerToken,
    lease_expires_at: acquired.leaseExpiresAt.toISOString()
  });

  let leaseLost = false;
  let renewInFlight = false;
  const heartbeat = setInterval(() => {
    if (leaseLost || renewInFlight) {
      return;
    }
    renewInFlight = true;
    renewWorkerLease({
      workerName: input.workerName,
      ownerToken,
      leaseDurationMs,
      client
    })
      .then((renewed) => {
        if (!renewed.renewed) {
          leaseLost = true;
          logger.error("worker-lease.lost", {
            worker_name: input.workerName,
            owner_token: ownerToken
          });
          clearInterval(heartbeat);
          return;
        }
        logger.info("worker-lease.renewed", {
          worker_name: input.workerName,
          owner_token: ownerToken,
          lease_expires_at: renewed.leaseExpiresAt.toISOString()
        });
      })
      .catch((error) => {
        leaseLost = true;
        logger.error("worker-lease.renew-failed", {
          worker_name: input.workerName,
          owner_token: ownerToken,
          error: error instanceof Error ? error.message : "unknown_error"
        });
        clearInterval(heartbeat);
      })
      .finally(() => {
        renewInFlight = false;
      });
  }, Math.max(1_000, renewIntervalMs));

  try {
    const result = await input.run();
    if (leaseLost) {
      throw new Error(`Lost lease ownership for worker ${input.workerName}`);
    }
    await releaseWorkerLease({
      workerName: input.workerName,
      ownerToken,
      completed: true,
      client
    });
    logger.info("worker-lease.released", {
      worker_name: input.workerName,
      owner_token: ownerToken,
      completed: true
    });
    return {
      skipped: false,
      ownerToken,
      result
    };
  } catch (error) {
    await releaseWorkerLease({
      workerName: input.workerName,
      ownerToken,
      completed: false,
      client
    }).catch((releaseError) => {
      logger.warn("worker-lease.release-failed", {
        worker_name: input.workerName,
        owner_token: ownerToken,
        error: releaseError instanceof Error ? releaseError.message : "unknown_error"
      });
    });

    logger.info("worker-lease.released", {
      worker_name: input.workerName,
      owner_token: ownerToken,
      completed: false
    });
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}
