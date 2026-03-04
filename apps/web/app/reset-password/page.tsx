import Link from "next/link";
import { redirect } from "next/navigation";
import { confirmPasswordReset } from "../../lib/api";

async function resetPasswordAction(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!token || !password) {
    return;
  }

  await confirmPasswordReset(token, password);
  redirect("/login");
}

export default async function ResetPasswordPage({
  searchParams
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  const token = params.token ?? "";

  return (
    <main className="login-shell">
      <div className="login-card">
        <p className="eyebrow">Synteq</p>
        <h1 className="login-title">Reset Password</h1>
        {token ? (
          <form className="login-form" action={resetPasswordAction}>
            <input type="hidden" name="token" value={token} />
            <label>
              New password
              <input name="password" type="password" minLength={8} required />
            </label>
            <button type="submit">Set New Password</button>
          </form>
        ) : (
          <p className="login-subtitle">Missing reset token. Request a new reset email.</p>
        )}
        <div className="mt-4">
          <Link href="/login" className="text-sm text-ocean">
            Back to login
          </Link>
        </div>
      </div>
    </main>
  );
}
