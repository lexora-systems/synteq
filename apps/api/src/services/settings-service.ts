import type { SupportedCurrency } from "@synteq/shared";
import { prisma } from "../lib/prisma.js";
import { normalizeCurrency } from "./currency-service.js";

export async function getTenantSettings(tenantId: string): Promise<{
  tenant_id: string;
  default_currency: SupportedCurrency;
}> {
  const tenant = await prisma.tenant.findUnique({
    where: {
      id: tenantId
    },
    select: {
      id: true,
      default_currency: true
    }
  });

  return {
    tenant_id: tenantId,
    default_currency: normalizeCurrency(tenant?.default_currency)
  };
}

export async function updateTenantSettings(input: {
  tenantId: string;
  defaultCurrency: SupportedCurrency;
}): Promise<{
  tenant_id: string;
  default_currency: SupportedCurrency;
}> {
  const tenant = await prisma.tenant.update({
    where: {
      id: input.tenantId
    },
    data: {
      default_currency: input.defaultCurrency
    },
    select: {
      id: true,
      default_currency: true
    }
  });

  return {
    tenant_id: tenant.id,
    default_currency: normalizeCurrency(tenant.default_currency)
  };
}

