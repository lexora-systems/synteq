import Link from "next/link";

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <section className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
        <Link href="/" className="text-sm font-semibold text-cyan-200 hover:text-cyan-100">
          Back to Synteq
        </Link>
        <p className="mt-8 text-xs uppercase tracking-[0.22em] text-cyan-200">Terms</p>
        <h1 className="mt-2 text-4xl font-semibold" data-testid="terms-page-title">
          Terms of Service
        </h1>
        <p className="mt-3 text-sm text-slate-400">Effective May 15, 2026</p>

        <div className="mt-8 space-y-6 text-sm leading-7 text-slate-300">
          <section>
            <h2 className="text-lg font-semibold text-white">Early Access</h2>
            <p className="mt-2">
              Synteq may be offered in a guarded early-access phase. Public signup can be disabled, while existing users
              and invited teammates may continue to use authorized access paths.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Permitted Use</h2>
            <p className="mt-2">
              Use Synteq to monitor operational metadata from systems you own or are authorized to operate. Do not send
              raw customer records, CRM contact data, message bodies, secrets, tokens, regulated data, or data you are
              not authorized to process.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Customer Responsibilities</h2>
            <p className="mt-2">
              You are responsible for configuring webhooks, ingestion keys, invite access, alert destinations, and email
              sender settings correctly. Alert delivery depends on configured scheduler and email/webhook infrastructure.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Service Expectations</h2>
            <p className="mt-2">
              Synteq provides operational visibility based on the signals received. It does not guarantee prevention of
              outages, detection of every incident, or delivery of every alert.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Access Control</h2>
            <p className="mt-2">
              Keep credentials and ingestion keys secure. Rotate or revoke keys if exposure is suspected. Workspace
              owners and admins are responsible for member access and integration controls.
            </p>
          </section>
        </div>
      </section>
    </main>
  );
}
