import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { apiBaseUrl } from "../../../lib/config";

async function acceptInviteAction(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "");
  const fullName = String(formData.get("full_name") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!token || !fullName || !password) {
    return;
  }

  const response = await fetch(`${apiBaseUrl}/v1/team/invite/${encodeURIComponent(token)}/accept`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      full_name: fullName,
      password
    }),
    cache: "no-store"
  });

  if (!response.ok) {
    return;
  }

  const payload = (await response.json()) as { token?: string; access_token?: string; refresh_token?: string };
  const accessToken = payload.access_token ?? payload.token;
  if (!accessToken || !payload.refresh_token) {
    return;
  }

  const cookieStore = await cookies();
  cookieStore.set("synteq_token", accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 15
  });
  cookieStore.set("synteq_refresh_token", payload.refresh_token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });

  redirect("/welcome");
}

export default async function InviteAcceptPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  return (
    <main className="login-shell">
      <div className="login-card">
        <p className="eyebrow">Synteq</p>
        <h1 className="login-title">Accept invite</h1>
        <p className="login-subtitle">Set your name and password to activate your account.</p>
        <form className="login-form" action={acceptInviteAction}>
          <input type="hidden" name="token" value={token} />
          <label>
            Full name
            <input name="full_name" type="text" required />
          </label>
          <label>
            Password
            <input name="password" type="password" minLength={8} required />
          </label>
          <button type="submit">Accept invite</button>
        </form>
      </div>
    </main>
  );
}
