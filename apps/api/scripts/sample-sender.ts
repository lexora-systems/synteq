import "dotenv/config";
import crypto from "node:crypto";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:8080";
const SYNTEQ_KEY = process.env.SYNTEQ_KEY ?? "";
const TENANT_ID = process.env.TENANT_ID ?? "";
const WORKFLOW_ID = process.env.WORKFLOW_ID ?? "";
const WORKFLOW_SLUG = process.env.WORKFLOW_SLUG ?? "payments-daily";
const ENVIRONMENT = process.env.ENVIRONMENT ?? "prod";
const COUNT = Number(process.env.COUNT ?? "60");
const HMAC_SECRET = process.env.INGEST_HMAC_SECRET;

if (!SYNTEQ_KEY || !TENANT_ID || !WORKFLOW_ID) {
  console.error("Missing SYNTEQ_KEY, TENANT_ID, or WORKFLOW_ID");
  process.exit(1);
}

function randomStatus() {
  const n = Math.random();
  if (n < 0.85) return "success";
  if (n < 0.95) return "failed";
  return "timeout";
}

function randomDurationMs(status: string) {
  if (status === "timeout") return 60_000 + Math.floor(Math.random() * 10_000);
  if (status === "failed") return 4_000 + Math.floor(Math.random() * 8_000);
  return 800 + Math.floor(Math.random() * 4_000);
}

async function sendExecution(i: number) {
  const status = randomStatus();
  const body = {
    event_ts: new Date().toISOString(),
    tenant_id: TENANT_ID,
    workflow_id: WORKFLOW_ID,
    workflow_slug: WORKFLOW_SLUG,
    environment: ENVIRONMENT,
    execution_id: `sample-${Math.floor(i / 2)}`,
    run_id: `run-${i}`,
    status,
    duration_ms: randomDurationMs(status),
    retry_count: Math.random() < 0.15 ? 1 : 0,
    error_class: status === "failed" ? "ValidationError" : undefined,
    error_message: status === "failed" ? "Synthetic failure from sample sender" : undefined,
    step_name: "extract",
    step_index: 1,
    payload: {
      source: "sample-sender",
      index: i
    }
  };

  const bodyString = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = HMAC_SECRET
    ? crypto.createHmac("sha256", HMAC_SECRET).update(`${timestamp}.${bodyString}`).digest("hex")
    : null;

  const response = await fetch(`${API_BASE_URL}/v1/ingest/execution`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Synteq-Key": SYNTEQ_KEY,
      ...(signature ? { "X-Synteq-Timestamp": timestamp, "X-Synteq-Signature": `sha256=${signature}` } : {})
    },
    body: bodyString
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`failed index=${i}`, response.status, text);
  }
}

async function sendHeartbeat() {
  const body = {
    tenant_id: TENANT_ID,
    workflow_id: WORKFLOW_ID,
    workflow_slug: WORKFLOW_SLUG,
    environment: ENVIRONMENT,
    heartbeat_ts: new Date().toISOString(),
    expected_interval_sec: 60
  };
  const bodyString = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = HMAC_SECRET
    ? crypto.createHmac("sha256", HMAC_SECRET).update(`${timestamp}.${bodyString}`).digest("hex")
    : null;

  await fetch(`${API_BASE_URL}/v1/ingest/heartbeat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Synteq-Key": SYNTEQ_KEY,
      ...(signature ? { "X-Synteq-Timestamp": timestamp, "X-Synteq-Signature": `sha256=${signature}` } : {})
    },
    body: bodyString
  });
}

async function main() {
  for (let i = 0; i < COUNT; i += 1) {
    await sendExecution(i);
  }
  await sendHeartbeat();
  console.log(`sent ${COUNT} events and one heartbeat to ${API_BASE_URL}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
