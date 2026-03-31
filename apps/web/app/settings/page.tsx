import Link from "next/link";
import { TopNav } from "../../components/top-nav";
import { fetchMe } from "../../lib/api";
import { requireToken } from "../../lib/auth";

export default async function SettingsIndexPage() {
  const token = await requireToken();
  const me = await fetchMe(token);
  const canManageTenant = ["owner", "admin"].includes(me.user.role);

  return (
    <main className="min-h-screen syn-app-shell pb-12">
      <TopNav />
      <section className="mx-auto w-full max-w-5xl px-4 pt-8">
        <div className="rounded-2xl bg-white p-6 shadow-panel">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Settings</p>
          <h2 className="mt-1 text-2xl font-semibold text-ink">Workspace and account controls</h2>
          <p className="mt-2 text-sm text-slate-600">
            Manage identity, workspace configuration, and control-plane setup for continuous operational awareness.
          </p>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Link href="/settings/profile" className="rounded-2xl bg-white p-5 shadow-panel">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Account</p>
            <h3 className="mt-1 text-lg font-semibold text-ink">Profile</h3>
            <p className="mt-2 text-sm text-slate-600">Password, account identity, and email verification.</p>
          </Link>

          <Link href="/settings/control-plane" className="rounded-2xl bg-white p-5 shadow-panel">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Control Plane</p>
            <h3 className="mt-1 text-lg font-semibold text-ink">Sources, keys, integrations, alerts</h3>
            <p className="mt-2 text-sm text-slate-600">
              Configure how Synteq receives signals and dispatches proactive notifications.
            </p>
          </Link>

          <Link href="/settings/tenant" className="rounded-2xl bg-white p-5 shadow-panel">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Tenant</p>
            <h3 className="mt-1 text-lg font-semibold text-ink">Workspace settings</h3>
            <p className="mt-2 text-sm text-slate-600">
              Currency and workspace-level configuration.
            </p>
            {!canManageTenant ? (
              <p className="mt-2 text-xs text-slate-500">Owner/admin required for changes.</p>
            ) : null}
          </Link>

          <Link href="/settings/team" className="rounded-2xl bg-white p-5 shadow-panel">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Team</p>
            <h3 className="mt-1 text-lg font-semibold text-ink">Users and roles</h3>
            <p className="mt-2 text-sm text-slate-600">Invite members, update roles, and manage team access.</p>
          </Link>

          <Link href="/settings/security" className="rounded-2xl bg-white p-5 shadow-panel md:col-span-2">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Security</p>
            <h3 className="mt-1 text-lg font-semibold text-ink">Security events</h3>
            <p className="mt-2 text-sm text-slate-600">Audit session and authentication security activity.</p>
          </Link>
        </div>
      </section>
    </main>
  );
}
