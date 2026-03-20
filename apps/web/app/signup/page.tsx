import Link from "next/link";

export default function SignupPage() {
  return (
    <main className="min-h-screen bg-cloud px-4 py-16 sm:px-6 lg:px-8">
      <section className="mx-auto w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-8 shadow-panel">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-ocean">Synteq Access</p>
        <h1 className="mt-2 text-3xl font-semibold text-ink">Signup is invite-only right now</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600 sm:text-base">
          Synteq is currently provisioned through tenant owner/admin invites. If you already have credentials, continue
          to login. If you have an invite link, open it directly to activate your account.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/login"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-gradient-to-r from-ink to-ocean px-5 text-sm font-semibold text-white"
          >
            Go to login
          </Link>
          <Link
            href="/"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-5 text-sm font-semibold text-ink"
          >
            Back to landing
          </Link>
        </div>
      </section>
    </main>
  );
}
