import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/config.js", () => ({
  config: {
    FX_RATE_USD: 1,
    FX_RATE_PHP: 56,
    FX_RATE_EUR: 0.92,
    FX_RATE_GBP: 0.79,
    FX_RATE_JPY: 150,
    FX_RATE_AUD: 1.53,
    FX_RATE_CAD: 1.36
  }
}));

describe("risk estimator currency integration", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("keeps USD unchanged for localized risk display", async () => {
    const { localizeRiskEstimate } = await import("../src/services/risk-estimator.js");
    const risk = localizeRiskEstimate(4800, "USD");
    expect(risk).toMatchObject({
      amount_usd: 4800,
      amount: 4800,
      currency: "USD",
      conversion_rate: 1
    });
  });

  it("converts USD risk amount for tenant currency", async () => {
    const { localizeRiskEstimate } = await import("../src/services/risk-estimator.js");
    const risk = localizeRiskEstimate(4800, "EUR");
    expect(risk).toMatchObject({
      amount_usd: 4800,
      amount: 4416,
      currency: "EUR",
      conversion_rate: 0.92
    });
  });
});

