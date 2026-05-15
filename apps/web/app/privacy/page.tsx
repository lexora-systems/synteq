import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <section className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
        <Link href="/" className="text-sm font-semibold text-cyan-200 hover:text-cyan-100">
          Back to Synteq
        </Link>
        <p className="mt-8 text-xs uppercase tracking-[0.22em] text-cyan-200">Privacy</p>
        <h1 className="mt-2 text-4xl font-semibold" data-testid="privacy-page-title">
          Privacy Policy
        </h1>
        <p className="mt-3 text-sm text-slate-400">Effective May 15, 2026</p>

        <div className="mt-8 space-y-6 text-sm leading-7 text-slate-300">
          <section>
            <h2 className="text-lg font-semibold text-white">What Synteq Handles</h2>
            <p className="mt-2">
              Synteq is designed to monitor systems - not access them. We process operational metadata such as source
              identifiers, workflow or job identifiers, run status, timestamps, retry counts, incident state, alert
              configuration, and related reliability context.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Webhook Data Boundaries</h2>
            <p className="mt-2">
              Customers control what they send to Synteq. Send workflow execution signals, not customer records. Avoid
              forwarding names, emails, phone numbers, addresses, notes, message bodies, secrets, tokens, full CRM
              records, or raw customer payloads.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">How Data Is Used</h2>
            <p className="mt-2">
              Operational metadata is used to authenticate ingestion, measure reliability, derive findings, surface
              incidents, and support configured alert delivery. Credentials and ingestion keys are used for verification
              and access control, not as analysis content.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Control</h2>
            <p className="mt-2">
              Workspace owners and admins can revoke or rotate ingestion keys, disable sources, disconnect supported
              integrations, and deactivate alert channels. Removing or disabling a source stops new accepted signals
              from that source.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Compliance Claims</h2>
            <p className="mt-2">
              Synteq does not claim SOC 2, HIPAA, PCI, or other formal certification unless a signed agreement or
              current Synteq documentation states otherwise.
            </p>
          </section>
        </div>
      </section>
    </main>
  );
}
