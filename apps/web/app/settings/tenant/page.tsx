import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { TopNav } from "../../../components/top-nav";
import { fetchMe, fetchTenantSettings, updateTenantSettings } from "../../../lib/api";
import type { SupportedCurrency } from "../../../lib/api";
import { requireToken } from "../../../lib/auth";

const supportedCurrencies: SupportedCurrency[] = ["USD", "PHP", "EUR", "GBP", "JPY", "AUD", "CAD"];

async function updateTenantCurrencyAction(formData: FormData) {
  "use server";
  const token = await requireToken();
  const defaultCurrency = String(formData.get("default_currency") ?? "USD") as SupportedCurrency;
  await updateTenantSettings(token, defaultCurrency);
  revalidatePath("/settings/tenant");
  revalidatePath("/overview");
  redirect("/settings/tenant?saved=1");
}

export default async function TenantSettingsPage({
  searchParams
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const params = await searchParams;
  const token = await requireToken();
  const me = await fetchMe(token);

  if (!["owner", "admin"].includes(me.user.role)) {
    return (
      <main className="min-h-screen bg-cloud pb-12">
        <TopNav />
        <section className="mx-auto w-full max-w-3xl px-4 pt-8">
          <div className="rounded-2xl bg-white p-6 shadow-panel">
            <h2 className="text-2xl font-semibold text-ink">Tenant Settings</h2>
            <p className="mt-2 text-sm text-slate-600">Only owner/admin can access this page.</p>
          </div>
        </section>
      </main>
    );
  }

  const { settings } = await fetchTenantSettings(token);

  return (
    <main className="min-h-screen bg-cloud pb-12">
      <TopNav />
      <section className="mx-auto w-full max-w-3xl px-4 pt-8">
        <div className="rounded-2xl bg-white p-6 shadow-panel">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Tenant</p>
          <h2 className="mt-1 text-2xl font-semibold text-ink">Display Currency</h2>
          <p className="mt-2 text-sm text-slate-600">
            Revenue risk remains calculated in USD internally. Synteq converts the result for dashboard display.
          </p>

          <form action={updateTenantCurrencyAction} className="mt-4 grid gap-3 md:grid-cols-[220px_auto]">
            <select
              name="default_currency"
              defaultValue={settings.default_currency}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              {supportedCurrencies.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
            <button className="w-fit rounded-lg bg-ocean px-4 py-2 text-sm font-semibold text-white">
              Save currency
            </button>
          </form>
          {params.saved === "1" ? (
            <p className="mt-3 text-sm text-mint">Tenant currency updated.</p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
