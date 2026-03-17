import { describe, expect, it, vi } from "vitest";
import {
  acquireWorkerLease,
  releaseWorkerLease,
  renewWorkerLease,
  runWithWorkerLease
} from "../src/services/worker-lease-service.js";

type LeaseRow = {
  worker_name: string;
  owner_token: string | null;
  lease_expires_at: Date | null;
  acquired_at: Date | null;
  renewed_at: Date | null;
  last_heartbeat_at: Date | null;
  last_completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function makeClient() {
  const state = {
    rows: new Map<string, LeaseRow>()
  };

  const matches = (row: LeaseRow, where: Record<string, unknown>): boolean => {
    for (const [key, value] of Object.entries(where)) {
      if (key === "OR") {
        const branches = value as Array<Record<string, unknown>>;
        if (!branches.some((branch) => matches(row, branch))) {
          return false;
        }
        continue;
      }

      if (key === "worker_name") {
        if (row.worker_name !== value) {
          return false;
        }
        continue;
      }

      if (key === "owner_token") {
        if (row.owner_token !== value) {
          return false;
        }
        continue;
      }

      if (key === "lease_expires_at") {
        if (value === null) {
          if (row.lease_expires_at !== null) {
            return false;
          }
          continue;
        }

        const filter = value as { lte?: Date; gt?: Date };
        if (Object.prototype.hasOwnProperty.call(filter, "lte")) {
          const current = row.lease_expires_at;
          if (!current || current.getTime() > new Date(filter.lte as Date).getTime()) {
            return false;
          }
        }
        if (Object.prototype.hasOwnProperty.call(filter, "gt")) {
          const current = row.lease_expires_at;
          if (!current || current.getTime() <= new Date(filter.gt as Date).getTime()) {
            return false;
          }
        }
      }
    }
    return true;
  };

  const applyData = (row: LeaseRow, data: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(data)) {
      (row as Record<string, unknown>)[key] = value as unknown;
    }
    row.updated_at = new Date();
  };

  const client = {
    workerLease: {
      create: async (args: any) => {
        const data = args.data;
        if (state.rows.has(data.worker_name)) {
          throw new Error("unique violation");
        }
        const now = new Date();
        const row: LeaseRow = {
          worker_name: data.worker_name,
          owner_token: data.owner_token ?? null,
          lease_expires_at: data.lease_expires_at ?? null,
          acquired_at: data.acquired_at ?? null,
          renewed_at: data.renewed_at ?? null,
          last_heartbeat_at: data.last_heartbeat_at ?? null,
          last_completed_at: data.last_completed_at ?? null,
          created_at: now,
          updated_at: now
        };
        state.rows.set(row.worker_name, row);
        return row;
      },
      findUnique: async (args: any) => {
        const row = state.rows.get(args.where.worker_name);
        return row ? { ...row } : null;
      },
      updateMany: async (args: any) => {
        let count = 0;
        for (const row of state.rows.values()) {
          if (matches(row, args.where)) {
            applyData(row, args.data);
            count += 1;
          }
        }
        return { count };
      },
      update: async (args: any) => {
        const row = state.rows.get(args.where.worker_name);
        if (!row) {
          throw new Error("not found");
        }
        applyData(row, args.data);
        return { ...row };
      }
    }
  };

  return {
    state,
    client
  };
}

describe("worker lease service", () => {
  it("acquires first lease successfully", async () => {
    const { state, client } = makeClient();
    const now = new Date("2026-03-17T12:00:00.000Z");

    const acquired = await acquireWorkerLease({
      workerName: "operational-events-worker",
      ownerToken: "owner-A",
      now,
      leaseDurationMs: 30_000,
      client: client as any
    });

    expect(acquired.acquired).toBe(true);
    expect(state.rows.get("operational-events-worker")?.owner_token).toBe("owner-A");
  });

  it("skips second concurrent acquisition while lease is active", async () => {
    const { client } = makeClient();
    const now = new Date("2026-03-17T12:00:00.000Z");

    await acquireWorkerLease({
      workerName: "incident-bridge-worker",
      ownerToken: "owner-A",
      now,
      leaseDurationMs: 30_000,
      client: client as any
    });

    const second = await acquireWorkerLease({
      workerName: "incident-bridge-worker",
      ownerToken: "owner-B",
      now: new Date("2026-03-17T12:00:01.000Z"),
      leaseDurationMs: 30_000,
      client: client as any
    });

    expect(second.acquired).toBe(false);
    if (!second.acquired) {
      expect(second.heldByOwnerToken).toBe("owner-A");
    }
  });

  it("allows reclaim when lease is expired", async () => {
    const { state, client } = makeClient();
    await acquireWorkerLease({
      workerName: "operational-events-worker",
      ownerToken: "owner-A",
      now: new Date("2026-03-17T12:00:00.000Z"),
      leaseDurationMs: 5_000,
      client: client as any
    });

    const reclaimed = await acquireWorkerLease({
      workerName: "operational-events-worker",
      ownerToken: "owner-B",
      now: new Date("2026-03-17T12:00:10.000Z"),
      leaseDurationMs: 5_000,
      client: client as any
    });

    expect(reclaimed.acquired).toBe(true);
    expect(state.rows.get("operational-events-worker")?.owner_token).toBe("owner-B");
  });

  it("renews lease ownership and extends expiration", async () => {
    const { state, client } = makeClient();
    await acquireWorkerLease({
      workerName: "incident-bridge-worker",
      ownerToken: "owner-A",
      now: new Date("2026-03-17T12:00:00.000Z"),
      leaseDurationMs: 10_000,
      client: client as any
    });

    const renewed = await renewWorkerLease({
      workerName: "incident-bridge-worker",
      ownerToken: "owner-A",
      now: new Date("2026-03-17T12:00:05.000Z"),
      leaseDurationMs: 10_000,
      client: client as any
    });

    expect(renewed.renewed).toBe(true);
    expect(state.rows.get("incident-bridge-worker")?.lease_expires_at?.toISOString()).toBe(
      "2026-03-17T12:00:15.000Z"
    );
  });

  it("run wrapper exits cleanly when lease is not acquired", async () => {
    const { client } = makeClient();
    await acquireWorkerLease({
      workerName: "operational-events-worker",
      ownerToken: "owner-A",
      now: new Date("2026-03-17T12:00:00.000Z"),
      leaseDurationMs: 60_000,
      client: client as any
    });

    const runMock = vi.fn(async () => ({ processed: 1 }));
    const result = await runWithWorkerLease({
      workerName: "operational-events-worker",
      ownerToken: "owner-B",
      settings: {
        leaseDurationMs: 60_000,
        renewIntervalMs: 10_000
      },
      run: runMock,
      client: client as any
    });

    expect(result.skipped).toBe(true);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("run wrapper updates completion metadata on success", async () => {
    const { state, client } = makeClient();
    const runMock = vi.fn(async () => ({ processed: 5 }));

    const result = await runWithWorkerLease({
      workerName: "incident-bridge-worker",
      ownerToken: "owner-C",
      settings: {
        leaseDurationMs: 30_000,
        renewIntervalMs: 10_000
      },
      run: runMock,
      client: client as any
    });

    expect(result.skipped).toBe(false);
    expect(runMock).toHaveBeenCalledTimes(1);

    const row = state.rows.get("incident-bridge-worker");
    expect(row?.owner_token).toBeNull();
    expect(row?.lease_expires_at).toBeNull();
    expect(row?.last_completed_at).toBeInstanceOf(Date);
  });

  it("release call clears active ownership", async () => {
    const { state, client } = makeClient();
    await acquireWorkerLease({
      workerName: "operational-events-worker",
      ownerToken: "owner-A",
      now: new Date("2026-03-17T12:00:00.000Z"),
      leaseDurationMs: 20_000,
      client: client as any
    });

    const released = await releaseWorkerLease({
      workerName: "operational-events-worker",
      ownerToken: "owner-A",
      completed: true,
      now: new Date("2026-03-17T12:00:03.000Z"),
      client: client as any
    });

    expect(released.released).toBe(true);
    expect(state.rows.get("operational-events-worker")?.owner_token).toBeNull();
  });
});
