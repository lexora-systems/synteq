import { revalidatePath } from "next/cache";
import { TopNav } from "../../../components/top-nav";
import { changePassword, fetchMe, requestEmailVerification } from "../../../lib/api";
import { requireToken } from "../../../lib/auth";

async function changePasswordAction(formData: FormData) {
  "use server";
  const token = await requireToken();
  const currentPassword = String(formData.get("current_password") ?? "");
  const nextPassword = String(formData.get("new_password") ?? "");

  if (!currentPassword || !nextPassword) {
    return;
  }

  await changePassword(token, currentPassword, nextPassword);
  revalidatePath("/settings/profile");
}

async function requestVerificationAction() {
  "use server";
  const token = await requireToken();
  await requestEmailVerification(token);
  revalidatePath("/settings/profile");
}

export default async function ProfileSettingsPage() {
  const token = await requireToken();
  const payload = await fetchMe(token);
  const user = payload.user;

  return (
    <main className="min-h-screen syn-app-shell pb-12">
      <TopNav />
      <section className="mx-auto grid w-full max-w-3xl gap-4 px-4 pt-8">
        <div className="rounded-2xl bg-white p-6 shadow-panel">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Profile</p>
          <h2 className="mt-1 text-2xl font-semibold text-ink">{user.full_name}</h2>
          <div className="mt-3 grid gap-2 text-sm text-slate-600">
            <p>
              Email: <strong>{user.email}</strong>
            </p>
            <p>
              Role: <strong>{user.role}</strong>
            </p>
            <p>
              Verified: <strong>{user.email_verified_at ? "Yes" : "No"}</strong>
            </p>
            <p>
              Tenant: <strong>{user.tenant_id}</strong>
            </p>
          </div>
          {!user.email_verified_at ? (
            <form action={requestVerificationAction} className="mt-4">
              <button className="rounded-lg border border-ocean px-3 py-2 text-sm font-semibold text-ocean">Send verification email</button>
            </form>
          ) : null}
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-panel">
          <h3 className="text-lg font-semibold text-ink">Change Password</h3>
          <form action={changePasswordAction} className="mt-3 grid gap-3">
            <label className="grid gap-1 text-sm text-slate-600">
              Current password
              <input name="current_password" type="password" required className="rounded-lg border border-slate-200 px-3 py-2" />
            </label>
            <label className="grid gap-1 text-sm text-slate-600">
              New password
              <input name="new_password" type="password" required minLength={8} className="rounded-lg border border-slate-200 px-3 py-2" />
            </label>
            <button className="w-fit rounded-lg bg-ocean px-4 py-2 text-sm font-semibold text-white">Update password</button>
          </form>
        </div>
      </section>
    </main>
  );
}

