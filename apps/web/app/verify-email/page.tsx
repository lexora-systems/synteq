import Link from "next/link";
import { confirmEmailVerification } from "../../lib/api";

export default async function VerifyEmailPage({
  searchParams
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  const token = params.token;

  let ok = false;
  if (token) {
    try {
      await confirmEmailVerification(token);
      ok = true;
    } catch {
      ok = false;
    }
  }

  return (
    <main className="login-shell">
      <div className="login-card">
        <p className="eyebrow">Synteq by Lexora</p>
        <h1 className="login-title">Email Verification</h1>
        <p className="login-subtitle">
          {ok
            ? "Your email is now verified."
            : "Verification link is invalid or expired. Request a new link from your profile."}
        </p>
        <div className="mt-4 flex gap-3">
          <Link href="/login" className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
            Go to Login
          </Link>
          <Link href="/settings/profile" className="rounded-lg bg-ocean px-3 py-2 text-sm font-semibold text-white">
            Open Profile
          </Link>
        </div>
      </div>
    </main>
  );
}
