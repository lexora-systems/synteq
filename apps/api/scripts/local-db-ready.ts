import "dotenv/config";
import net from "node:net";
import { spawnSync } from "node:child_process";

const EXPECTED_LOCAL_MYSQL_PORT = 3306;
const DEFAULT_CONTAINER_NAME = "synteq-mysql";
const DEFAULT_MYSQL_IMAGE = "mysql:8.4";
const DEFAULT_ROOT_PASSWORD = "root";
const DEFAULT_DATABASE = "synteq";
const CONNECTION_TIMEOUT_MS = 1_500;
const WAIT_ATTEMPTS = 12;
const WAIT_INITIAL_DELAY_MS = 1_000;
const WAIT_MAX_DELAY_MS = 5_000;

type CommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  status: number | null;
  error?: Error;
};

type WaitResult = {
  ok: boolean;
  attempts: number;
};

type DbTarget = {
  url: string;
  host: string;
  port: number;
};

function logInfo(message: string) {
  console.log(`[db-ready] ${message}`);
}

function logError(message: string) {
  console.error(`[db-ready] ${message}`);
}

function runCommand(command: string, args: string[]): CommandResult {
  const result = spawnSync(command, args, {
    encoding: "utf8"
  });

  return {
    ok: result.status === 0,
    stdout: result.stdout?.toString().trim() ?? "",
    stderr: result.stderr?.toString().trim() ?? "",
    status: result.status,
    error: result.error
  };
}

function parseDatabaseTarget(): DbTarget {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error(
      "DATABASE_URL is not set. Configure apps/api/.env first (example: mysql://root:root@localhost:3306/synteq)."
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`DATABASE_URL is not a valid URL: "${raw}"`);
  }

  if (parsed.protocol !== "mysql:") {
    throw new Error(
      `DATABASE_URL must use mysql:// for local checks. Current protocol: "${parsed.protocol}".`
    );
  }

  const host = parsed.hostname || "localhost";
  const parsedPort = Number(parsed.port || EXPECTED_LOCAL_MYSQL_PORT);
  if (!Number.isFinite(parsedPort) || parsedPort <= 0) {
    throw new Error(`DATABASE_URL has an invalid port: "${parsed.port}"`);
  }

  return {
    url: raw,
    host,
    port: parsedPort
  };
}

function isLocalHost(host: string) {
  const normalized = host.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function isCiEnvironment() {
  return process.env.CI === "true";
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function checkTcpConnection(host: string, port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };

    socket.setTimeout(CONNECTION_TIMEOUT_MS);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function waitForTcpReady(host: string, port: number): Promise<WaitResult> {
  let delayMs = WAIT_INITIAL_DELAY_MS;

  for (let attempt = 1; attempt <= WAIT_ATTEMPTS; attempt += 1) {
    const connected = await checkTcpConnection(host, port);
    if (connected) {
      return {
        ok: true,
        attempts: attempt
      };
    }

    if (attempt < WAIT_ATTEMPTS) {
      logInfo(`MySQL not ready yet on ${host}:${port} (attempt ${attempt}/${WAIT_ATTEMPTS}); retrying in ${delayMs}ms...`);
      await sleep(delayMs);
      delayMs = Math.min(WAIT_MAX_DELAY_MS, Math.round(delayMs * 1.5));
    }
  }

  return {
    ok: false,
    attempts: WAIT_ATTEMPTS
  };
}

function dockerAvailable() {
  const result = runCommand("docker", ["info", "--format", "{{.ServerVersion}}"]);
  if (result.ok) {
    logInfo(`Docker daemon detected (version ${result.stdout || "unknown"}).`);
    return true;
  }

  if (result.error) {
    logError(`Docker CLI is unavailable: ${result.error.message}`);
  } else {
    logError(result.stderr || "Docker daemon is not reachable.");
  }

  return false;
}

function findLocalMySqlContainer(containerName: string) {
  const result = runCommand("docker", [
    "ps",
    "-a",
    "--filter",
    `name=^/${containerName}$`,
    "--format",
    "{{.Names}}\t{{.Status}}"
  ]);

  if (!result.ok) {
    throw new Error(result.stderr || "Unable to inspect Docker containers.");
  }

  if (!result.stdout) {
    return {
      exists: false,
      running: false,
      status: ""
    };
  }

  const [namePart, ...statusParts] = result.stdout.split("\t");
  const status = statusParts.join("\t").trim();
  return {
    exists: namePart.trim() === containerName,
    running: status.toLowerCase().startsWith("up "),
    status
  };
}

function createLocalMySqlContainer(containerName: string) {
  logInfo(`Creating local MySQL container "${containerName}" (${DEFAULT_MYSQL_IMAGE})...`);
  const result = runCommand("docker", [
    "run",
    "--name",
    containerName,
    "-e",
    `MYSQL_ROOT_PASSWORD=${DEFAULT_ROOT_PASSWORD}`,
    "-e",
    `MYSQL_DATABASE=${DEFAULT_DATABASE}`,
    "-p",
    `${EXPECTED_LOCAL_MYSQL_PORT}:${EXPECTED_LOCAL_MYSQL_PORT}`,
    "-d",
    DEFAULT_MYSQL_IMAGE
  ]);

  if (!result.ok) {
    const detail = result.stderr || result.stdout || "docker run failed";
    throw new Error(
      `Could not create local MySQL container "${containerName}". ${detail}\n` +
        `Try running manually:\n` +
        `  docker run --name ${containerName} -e MYSQL_ROOT_PASSWORD=${DEFAULT_ROOT_PASSWORD} -e MYSQL_DATABASE=${DEFAULT_DATABASE} -p ${EXPECTED_LOCAL_MYSQL_PORT}:${EXPECTED_LOCAL_MYSQL_PORT} -d ${DEFAULT_MYSQL_IMAGE}`
    );
  }
}

function startLocalMySqlContainer(containerName: string) {
  logInfo(`Starting local MySQL container "${containerName}"...`);
  const result = runCommand("docker", ["start", containerName]);
  if (!result.ok) {
    const detail = result.stderr || result.stdout || "docker start failed";
    throw new Error(
      `Could not start local MySQL container "${containerName}". ${detail}\n` +
        `Try running manually:\n` +
        `  docker start ${containerName}`
    );
  }
}

function printFinalTroubleshooting(containerName: string, host: string, port: number) {
  logError(`MySQL is still unreachable at ${host}:${port}.`);
  console.error("Actionable checks:");
  console.error("  1) Confirm Docker Desktop is running.");
  console.error(`  2) Run: docker ps -a --filter "name=^/${containerName}$"`);
  console.error(`  3) Run: docker logs ${containerName} --tail 100`);
  console.error(`  4) Verify port mapping for ${containerName} includes ${port}->3306.`);
}

async function ensureLocalMySqlContainer(containerName: string) {
  const state = findLocalMySqlContainer(containerName);
  if (!state.exists) {
    createLocalMySqlContainer(containerName);
    return;
  }

  if (state.running) {
    logInfo(`Local MySQL container "${containerName}" is already running (${state.status}).`);
    return;
  }

  logInfo(`Local MySQL container "${containerName}" exists but is not running (${state.status || "stopped"}).`);
  startLocalMySqlContainer(containerName);
}

async function main() {
  const target = parseDatabaseTarget();
  const containerName = process.env.SYNTEQ_LOCAL_MYSQL_CONTAINER || DEFAULT_CONTAINER_NAME;

  logInfo(`Checking database readiness for ${target.host}:${target.port}...`);

  const immediate = await checkTcpConnection(target.host, target.port);
  if (immediate) {
    logInfo(`Database is reachable at ${target.host}:${target.port}.`);
    return;
  }

  const local3306 = isLocalHost(target.host) && target.port === EXPECTED_LOCAL_MYSQL_PORT;
  if (local3306 && !isCiEnvironment()) {
    logInfo(
      `DATABASE_URL points to local MySQL (${target.url}). Attempting Docker-assisted recovery for "${containerName}".`
    );

    if (!dockerAvailable()) {
      throw new Error(
        `Docker is not available and MySQL is down on ${target.host}:${target.port}.\n` +
          `Start Docker Desktop, then run:\n` +
          `  docker start ${containerName}\n` +
          `Or create it:\n` +
          `  docker run --name ${containerName} -e MYSQL_ROOT_PASSWORD=${DEFAULT_ROOT_PASSWORD} -e MYSQL_DATABASE=${DEFAULT_DATABASE} -p ${EXPECTED_LOCAL_MYSQL_PORT}:${EXPECTED_LOCAL_MYSQL_PORT} -d ${DEFAULT_MYSQL_IMAGE}`
      );
    }

    await ensureLocalMySqlContainer(containerName);
  } else {
    logInfo(
      `Skipping Docker-assisted recovery (host=${target.host}, port=${target.port}, CI=${isCiEnvironment()}).`
    );
  }

  const waited = await waitForTcpReady(target.host, target.port);
  if (!waited.ok) {
    if (local3306) {
      printFinalTroubleshooting(containerName, target.host, target.port);
    }
    throw new Error(
      `Database readiness check timed out after ${waited.attempts} attempts.\n` +
        `Expected MySQL at ${target.host}:${target.port}.`
    );
  }

  logInfo(`Database is reachable at ${target.host}:${target.port} after ${waited.attempts} attempt(s).`);
}

main().catch((error) => {
  logError(error instanceof Error ? error.message : "unknown error");
  process.exit(1);
});
