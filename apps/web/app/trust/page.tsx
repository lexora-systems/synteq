import Link from "next/link";

export default function TrustPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <section className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
        <Link href="/" className="text-sm font-semibold text-cyan-200 hover:text-cyan-100">
          Back to Synteq
        </Link>
        <p className="mt-8 text-xs uppercase tracking-[0.22em] text-cyan-200">Trust</p>
        <h1 className="mt-2 text-4xl font-semibold" data-testid="trust-page-title">
          Security and Trust
        </h1>
        <p className="mt-3 text-sm text-slate-400">Designed to monitor systems - not access them.</p>

        <div className="mt-8 space-y-6 text-sm leading-7 text-slate-300">
          <section>
            <h2 className="text-lg font-semibold text-white">Minimal Access Model</h2>
            <p className="mt-2">
              Synteq uses webhook and API-key ingestion paths for operational event metadata. The source type for generic
              webhook workflows remains webhook, including GoHighLevel outbound webhook setups.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">What To Send</h2>
            <p className="mt-2">
              Send status, timing, workflow, job, run, source, and delivery identifiers needed for reliability analysis.
              Do not send raw CRM/contact records, names, emails, phone numbers, notes, message bodies, secrets, tokens,
              or full customer payloads.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Key Handling</h2>
            <p className="mt-2">
              Ingestion keys and webhook secrets authenticate senders. Use production-grade secrets, rotate exposed keys,
              and keep optional HMAC or signature verification enabled where supported by the configured integration.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Operational Truth</h2>
            <p className="mt-2">
              Monitoring becomes active after real workflow events arrive. Alert delivery depends on configured
              scheduler and email/webhook infrastructure. Synteq avoids claiming alert readiness when those dependencies
              are not verified.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Revocation</h2>
            <p className="mt-2">
              Owners and admins can disable sources, rotate or revoke keys, disconnect supported integrations, and
              deactivate alert channels from the control plane.
            </p>
          </section>
        </div>
      </section>
    </main>
  );
}
