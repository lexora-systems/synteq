const RANGE_TO_MINUTES: Record<string, number> = {
  "15m": 15,
  "1h": 60,
  "6h": 360,
  "24h": 1440,
  "7d": 10080
};

export function getRangeMinutes(range: keyof typeof RANGE_TO_MINUTES): number {
  return RANGE_TO_MINUTES[range] ?? 60;
}
