import crypto from "node:crypto";

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function hashApiKey(rawKey: string, salt: string): string {
  return sha256(`${salt}:${rawKey}`);
}

export function hmacSha256(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export function secureCompareHex(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const leftBuf = Buffer.from(left, "hex");
  const rightBuf = Buffer.from(right, "hex");
  if (leftBuf.length !== rightBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuf, rightBuf);
}

export function minuteBucketIso(ts: Date): string {
  const bucket = new Date(ts);
  bucket.setUTCSeconds(0, 0);
  return bucket.toISOString();
}

export function buildExecutionFingerprint(input: {
  tenantId: string;
  workflowId: string;
  executionId: string;
  eventTs: Date;
}): string {
  return sha256(`${input.tenantId}|${input.workflowId}|${minuteBucketIso(input.eventTs)}|${input.executionId}`);
}

export function buildHeartbeatFingerprint(input: {
  tenantId: string;
  workflowId: string;
  heartbeatTs: Date;
}): string {
  return sha256(`${input.tenantId}|${input.workflowId}|heartbeat|${minuteBucketIso(input.heartbeatTs)}`);
}

export function buildIncidentFingerprint(input: {
  tenantId: string;
  workflowId: string;
  metric: string;
  timeBucket: string;
}): string {
  return sha256(`${input.tenantId}|${input.workflowId}|${input.metric}|${input.timeBucket}`);
}

export function randomApiKey(): string {
  return `synteq_${crypto.randomBytes(24).toString("hex")}`;
}

export function randomOpaqueToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}
