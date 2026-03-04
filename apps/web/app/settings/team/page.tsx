import { revalidatePath } from "next/cache";
import { TopNav } from "../../../components/top-nav";
import {
  disableTeamUser,
  fetchMe,
  fetchTeamInvites,
  fetchTeamUsers,
  inviteTeamUser,
  updateTeamUserRole
} from "../../../lib/api";
import { requireToken } from "../../../lib/auth";

type Role = "owner" | "admin" | "engineer" | "viewer";

async function inviteUserAction(formData: FormData) {
  "use server";
  const token = await requireToken();
  const email = String(formData.get("email") ?? "");
  const role = String(formData.get("role") ?? "viewer") as Role;
  if (!email) return;

  await inviteTeamUser(token, email, role);
  revalidatePath("/settings/team");
}

async function changeRoleAction(formData: FormData) {
  "use server";
  const token = await requireToken();
  const userId = String(formData.get("user_id") ?? "");
  const role = String(formData.get("role") ?? "viewer") as Role;
  if (!userId) return;

  await updateTeamUserRole(token, userId, role);
  revalidatePath("/settings/team");
}

async function disableUserAction(formData: FormData) {
  "use server";
  const token = await requireToken();
  const userId = String(formData.get("user_id") ?? "");
  if (!userId) return;

  await disableTeamUser(token, userId);
  revalidatePath("/settings/team");
}

export default async function TeamSettingsPage() {
  const token = await requireToken();
  const me = await fetchMe(token);

  if (!["owner", "admin"].includes(me.user.role)) {
    return (
      <main className="min-h-screen bg-cloud pb-12">
        <TopNav />
        <section className="mx-auto w-full max-w-3xl px-4 pt-8">
          <div className="rounded-2xl bg-white p-6 shadow-panel">
            <h2 className="text-2xl font-semibold text-ink">Team Settings</h2>
            <p className="mt-2 text-sm text-slate-600">Only owner/admin can access this page.</p>
          </div>
        </section>
      </main>
    );
  }

  const [usersPayload, invitesPayload] = await Promise.all([fetchTeamUsers(token), fetchTeamInvites(token)]);

  return (
    <main className="min-h-screen bg-cloud pb-12">
      <TopNav />
      <section className="mx-auto grid w-full max-w-5xl gap-4 px-4 pt-8">
        <div className="rounded-2xl bg-white p-6 shadow-panel">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Team</p>
          <h2 className="mt-1 text-2xl font-semibold text-ink">Invite Team Member</h2>
          <form action={inviteUserAction} className="mt-4 grid gap-3 md:grid-cols-[1fr_180px_auto]">
            <input
              name="email"
              type="email"
              placeholder="teammate@company.com"
              required
              className="rounded-lg border border-slate-200 px-3 py-2"
            />
            <select name="role" defaultValue="viewer" className="rounded-lg border border-slate-200 px-3 py-2">
              <option value="viewer">viewer</option>
              <option value="engineer">engineer</option>
              <option value="admin">admin</option>
              <option value="owner">owner</option>
            </select>
            <button className="rounded-lg bg-ocean px-4 py-2 text-sm font-semibold text-white">
              Send Invite
            </button>
          </form>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-panel">
          <h3 className="text-lg font-semibold text-ink">Users</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-2">Name</th>
                  <th className="py-2">Email</th>
                  <th className="py-2">Role</th>
                  <th className="py-2">Verified</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {usersPayload.users.map((user) => (
                  <tr key={user.id} className="border-b border-slate-100 align-top">
                    <td className="py-3 pr-2 text-ink">{user.full_name}</td>
                    <td className="py-3 pr-2">{user.email}</td>
                    <td className="py-3 pr-2">{user.role}</td>
                    <td className="py-3 pr-2">{user.email_verified_at ? "yes" : "no"}</td>
                    <td className="py-3 pr-2">{user.disabled_at ? "disabled" : "active"}</td>
                    <td className="py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <form action={changeRoleAction} className="flex items-center gap-2">
                          <input type="hidden" name="user_id" value={user.id} />
                          <select
                            name="role"
                            defaultValue={user.role}
                            className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                          >
                            <option value="viewer">viewer</option>
                            <option value="engineer">engineer</option>
                            <option value="admin">admin</option>
                            <option value="owner">owner</option>
                          </select>
                          <button className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-700">
                            Update role
                          </button>
                        </form>
                        {!user.disabled_at ? (
                          <form action={disableUserAction}>
                            <input type="hidden" name="user_id" value={user.id} />
                            <button className="rounded-lg border border-rose-300 px-2 py-1 text-xs text-rose-700">
                              Disable
                            </button>
                          </form>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-panel">
          <h3 className="text-lg font-semibold text-ink">Invites</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-2">Email</th>
                  <th className="py-2">Role</th>
                  <th className="py-2">Invited by</th>
                  <th className="py-2">Expires</th>
                  <th className="py-2">Accepted</th>
                </tr>
              </thead>
              <tbody>
                {invitesPayload.invites.map((invite) => (
                  <tr key={invite.id} className="border-b border-slate-100 align-top">
                    <td className="py-3 pr-2">{invite.email}</td>
                    <td className="py-3 pr-2">{invite.role}</td>
                    <td className="py-3 pr-2">{invite.invited_by_user?.full_name ?? invite.invited_by_user?.email}</td>
                    <td className="py-3 pr-2">{new Date(invite.expires_at).toLocaleString()}</td>
                    <td className="py-3 pr-2">{invite.accepted_at ? new Date(invite.accepted_at).toLocaleString() : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  );
}
