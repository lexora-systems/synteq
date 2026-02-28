export type ProportionZInput = {
  total: number;
  failures: number;
  baselineRate: number;
};

export function proportionZScore(input: ProportionZInput): number {
  if (input.total <= 0) {
    return 0;
  }

  const p0 = Math.min(Math.max(input.baselineRate, 1e-9), 1 - 1e-9);
  const pHat = input.failures / input.total;
  const se = Math.sqrt((p0 * (1 - p0)) / input.total);

  if (se === 0) {
    return 0;
  }

  return (pHat - p0) / se;
}

export function median(values: number[]): number {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }

  return sorted[mid];
}

export function mad(values: number[]): number {
  if (!values.length) {
    return 0;
  }

  const m = median(values);
  const deviations = values.map((v) => Math.abs(v - m));
  return median(deviations);
}

export function robustZScore(current: number, history: number[]): number {
  if (!history.length) {
    return 0;
  }

  const med = median(history);
  const madValue = mad(history);
  const sigma = 1.4826 * madValue;

  if (sigma < 1e-9) {
    return 0;
  }

  return (current - med) / sigma;
}

export function poissonZScore(observed: number, baselineLambda: number): number {
  if (baselineLambda <= 0) {
    return observed > 0 ? 10 : 0;
  }

  return (observed - baselineLambda) / Math.sqrt(baselineLambda);
}

export function compareValue(value: number, threshold: number, comparator: "gt" | "gte" | "lt" | "lte" | "eq"): boolean {
  if (comparator === "gt") {
    return value > threshold;
  }

  if (comparator === "gte") {
    return value >= threshold;
  }

  if (comparator === "lt") {
    return value < threshold;
  }

  if (comparator === "lte") {
    return value <= threshold;
  }

  return Math.abs(value - threshold) < 1e-9;
}

export function rollingAverage(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const total = values.reduce((acc, value) => acc + value, 0);
  return total / values.length;
}

export function ewma(values: number[], alpha = 0.3): number {
  if (values.length === 0) {
    return 0;
  }

  let smoothed = values[0];
  for (let index = 1; index < values.length; index += 1) {
    smoothed = alpha * values[index] + (1 - alpha) * smoothed;
  }

  return smoothed;
}

export function smoothedBaseline(rolling: number, seasonal: number, seasonalWeight = 0.3): number {
  const seasonalSafe = Number.isFinite(seasonal) ? seasonal : rolling;
  const rollingSafe = Number.isFinite(rolling) ? rolling : seasonalSafe;
  return rollingSafe * (1 - seasonalWeight) + seasonalSafe * seasonalWeight;
}
