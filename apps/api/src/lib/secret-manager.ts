import "dotenv/config";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

const cache = new Map<string, string>();
let client: SecretManagerServiceClient | null = null;

function getClient() {
  if (!client) {
    client = new SecretManagerServiceClient();
  }

  return client;
}

function isSecretRef(value: string): boolean {
  return value.startsWith("sm://") || value.startsWith("projects/");
}

function normalizeSecretRef(value: string): string {
  if (value.startsWith("sm://")) {
    return value.slice(5);
  }

  return value;
}

async function accessSecretValue(name: string): Promise<string> {
  if (cache.has(name)) {
    return cache.get(name)!;
  }

  const [version] = await getClient().accessSecretVersion({ name });
  const payload = version.payload?.data?.toString("utf8")?.trim();
  if (!payload) {
    throw new Error(`Secret ${name} is empty`);
  }

  cache.set(name, payload);
  return payload;
}

export async function resolveEnvironmentSecrets(keys: string[]) {
  for (const key of keys) {
    const currentValue = process.env[key];
    if (!currentValue || !isSecretRef(currentValue)) {
      continue;
    }

    const secretName = normalizeSecretRef(currentValue);
    const resolved = await accessSecretValue(secretName);
    process.env[key] = resolved;
  }
}
