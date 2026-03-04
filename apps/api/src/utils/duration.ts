const DURATION_RE = /^(\d+)([smhd])$/i;

const MULTIPLIER_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000
};

export function parseDurationToMs(value: string): number {
  const match = DURATION_RE.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid duration "${value}". Expected formats like 15m, 30d, 60s.`);
  }

  const count = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = MULTIPLIER_MS[unit];

  if (!Number.isFinite(count) || count <= 0 || !multiplier) {
    throw new Error(`Invalid duration "${value}".`);
  }

  return count * multiplier;
}
