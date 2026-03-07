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

describe("currency service", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("converts USD to PHP deterministically", async () => {
    const { convertFromUsd } = await import("../src/services/currency-service.js");
    expect(convertFromUsd(100, "PHP")).toBe(5600);
  });

  it("converts USD to EUR deterministically", async () => {
    const { convertFromUsd } = await import("../src/services/currency-service.js");
    expect(convertFromUsd(100, "EUR")).toBe(92);
  });

  it("falls back to USD for unsupported currency", async () => {
    const { buildMoneyDisplay } = await import("../src/services/currency-service.js");
    const result = buildMoneyDisplay(100, "XXX");
    expect(result.currency).toBe("USD");
    expect(result.conversion_rate).toBe(1);
    expect(result.amount).toBe(100);
  });

  it("applies JPY rounding to zero decimals", async () => {
    const { convertFromUsd } = await import("../src/services/currency-service.js");
    expect(convertFromUsd(12.34, "JPY")).toBe(1851);
  });
});

