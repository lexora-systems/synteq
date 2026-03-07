import { buildMoneyDisplay } from "./currency-service.js";

const DEFAULT_AVG_ORDER_VALUE_USD = 120;
const FALLBACK_PROBLEM_RATE_FLOOR = 0.01;
const BASE_IMPACT_FACTOR = 0.35;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function estimateMonthlyRiskUsd(input: {
  monthlyEventVolume: number;
  successRate: number;
  duplicateRate: number;
  retryRate: number;
  avgOrderValueUsd?: number | null;
}): number {
  const monthlyEventVolume = Math.max(0, input.monthlyEventVolume);
  const avgOrderValueUsd =
    typeof input.avgOrderValueUsd === "number" && Number.isFinite(input.avgOrderValueUsd) && input.avgOrderValueUsd > 0
      ? input.avgOrderValueUsd
      : DEFAULT_AVG_ORDER_VALUE_USD;

  const failureRate = clamp(1 - input.successRate, 0, 1);
  const duplicateRate = clamp(input.duplicateRate, 0, 1);
  const retryRate = clamp(input.retryRate, 0, 1);

  const retryImpactRate = retryRate * 0.4;
  const problemRate = Math.max(failureRate, duplicateRate, retryImpactRate, FALLBACK_PROBLEM_RATE_FLOOR);
  const impactFactor = BASE_IMPACT_FACTOR + Math.min(0.6, problemRate);

  return Math.max(0, Math.round(monthlyEventVolume * problemRate * avgOrderValueUsd * impactFactor));
}

export function localizeRiskEstimate(amountUsd: number, preferredCurrency?: string | null) {
  return buildMoneyDisplay(amountUsd, preferredCurrency);
}
