import type { SupportedCurrency } from "@synteq/shared";
import { config } from "../config.js";

export const supportedCurrencies: SupportedCurrency[] = ["USD", "PHP", "EUR", "GBP", "JPY", "AUD", "CAD"];

const decimalPlacesByCurrency: Record<SupportedCurrency, number> = {
  USD: 2,
  PHP: 2,
  EUR: 2,
  GBP: 2,
  JPY: 0,
  AUD: 2,
  CAD: 2
};

function roundCurrency(amount: number, currency: SupportedCurrency): number {
  const decimals = decimalPlacesByCurrency[currency] ?? 2;
  return Number(amount.toFixed(decimals));
}

export function isSupportedCurrency(code: string | null | undefined): code is SupportedCurrency {
  if (!code) {
    return false;
  }

  return supportedCurrencies.includes(code as SupportedCurrency);
}

export function normalizeCurrency(code: string | null | undefined): SupportedCurrency {
  return isSupportedCurrency(code) ? code : "USD";
}

export function getRate(currency: SupportedCurrency): number {
  const rates: Record<SupportedCurrency, number> = {
    USD: config.FX_RATE_USD,
    PHP: config.FX_RATE_PHP,
    EUR: config.FX_RATE_EUR,
    GBP: config.FX_RATE_GBP,
    JPY: config.FX_RATE_JPY,
    AUD: config.FX_RATE_AUD,
    CAD: config.FX_RATE_CAD
  };

  return rates[currency] ?? 1;
}

export function convertFromUsd(amountUsd: number, currency: SupportedCurrency): number {
  const normalized = Number.isFinite(amountUsd) ? Math.max(0, amountUsd) : 0;
  return roundCurrency(normalized * getRate(currency), currency);
}

export function buildMoneyDisplay(amountUsd: number, currencyCode: string | null | undefined): {
  amount_usd: number;
  amount: number;
  currency: SupportedCurrency;
  conversion_rate: number;
} {
  const currency = normalizeCurrency(currencyCode);
  const amount_usd = Number.isFinite(amountUsd) ? Math.max(0, Math.round(amountUsd)) : 0;
  const conversion_rate = getRate(currency);
  const amount = convertFromUsd(amount_usd, currency);

  return {
    amount_usd,
    amount,
    currency,
    conversion_rate
  };
}

