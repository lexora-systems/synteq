import Link from "next/link";
import Image from "next/image";
import { getToken } from "../lib/auth";
import { resolveActivationState } from "../lib/activation";

const capabilityItems = [
  {
    title: "Continuously analyzes your systems",
    description: "Tracks execution signals across CI/CD, workflows, automations, and deployments to maintain a real-time view of system behavior."
  },
  {
    title: "Detects abnormal behavior early",
    description: "Identifies drift in failures, latency, retries, and cost patterns before instability becomes a production issue."
  },
  {
    title: "Simulates risk before it happens",
    description: "Run controlled scenarios to understand how your system behaves under stress and validate response readiness."
  },
  {
    title: "Surfaces incidents before escalation",
    description: "Transforms weak signals into actionable incidents with clear severity, risk context, and response direction."
  }
];

const benefitItems = [
  {
    title: "Detect instability early",
    description: "Catch rising failure and retry patterns while there is still time to prevent incident spread."
  },
  {
    title: "Prevent failed deployments",
    description: "Spot risk buildup between releases so high-impact deploy windows are not flying blind."
  },
  {
    title: "Understand system risk in real time",
    description: "Give engineering leaders a clear risk signal, not just disconnected logs and dashboard noise."
  },
  {
    title: "Reduce downtime and regressions",
    description: "Shorten time-to-detection and focus teams on the highest-risk workflows before escalation."
  }
];

const timelineItems = [
  { time: "09:42", label: "Retry storm trend detected", severity: "watch" },
  { time: "09:47", label: "Latency drift crossed threshold", severity: "high" },
  { time: "09:55", label: "Incident guidance generated", severity: "open" },
  { time: "10:02", label: "Escalation prevented after mitigation", severity: "resolved" }
];

function CircuitDivider({ reverse = false }: { reverse?: boolean }) {
  return (
    <div className="syn-circuit-divider" aria-hidden>
      <svg viewBox="0 0 1600 64" preserveAspectRatio="none" className="syn-circuit-divider-svg">
        <g>
          <path
            className={`syn-divider-flow syn-divider-flow-a${reverse ? " syn-divider-flow-reverse" : ""}`}
            pathLength="100"
            d="M0 32 H200 V18 H380 V32 H560 V46 H760 V32 H980 V18 H1180 V32 H1400 V46 H1600"
          />
          <path
            className={`syn-divider-flow syn-divider-flow-b${reverse ? " syn-divider-flow-reverse" : ""}`}
            pathLength="100"
            d="M120 32 H300"
          />
          <path
            className={`syn-divider-flow syn-divider-flow-c${reverse ? " syn-divider-flow-reverse" : ""}`}
            pathLength="100"
            d="M690 32 H900"
          />
        </g>

        <g>
          <circle className="syn-divider-node syn-divider-node-a" cx="200" cy="32" r="3.8" />
          <circle className="syn-divider-node syn-divider-node-b" cx="380" cy="32" r="3.8" />
          <circle className="syn-divider-node syn-divider-node-c" cx="560" cy="46" r="3.8" />
          <circle className="syn-divider-node syn-divider-node-d" cx="760" cy="32" r="4.2" />
          <circle className="syn-divider-node syn-divider-node-a" cx="980" cy="18" r="3.8" />
          <circle className="syn-divider-node syn-divider-node-b" cx="1180" cy="32" r="3.8" />
          <circle className="syn-divider-node syn-divider-node-c" cx="1400" cy="46" r="3.8" />
        </g>
      </svg>
    </div>
  );
}

export default async function PublicLandingPage() {
  const token = await getToken();
  const activation = token ? await resolveActivationState(token) : null;
  const isActivated = Boolean(activation?.activated && !activation?.metricsUnavailable);
  const startHref = token ? (isActivated ? "/overview" : "/welcome") : "/signup";
  const startLabel = isActivated ? "Open Dashboard" : "Create Workspace";
  const loginHref = token ? "/overview" : "/login";
  const simulationHref = token ? "/overview#investigation-tools" : "/login";

  return (
    <main className="min-h-screen bg-[#040915] text-slate-100">
      <section className="relative overflow-hidden bg-[radial-gradient(circle_at_20%_20%,rgba(45,212,191,0.2),transparent_35%),radial-gradient(circle_at_80%_0%,rgba(56,189,248,0.22),transparent_38%),linear-gradient(135deg,#050b16_0%,#0b1630_48%,#101f3d_100%)]">
        <div className="syn-hero-circuit pointer-events-none absolute inset-0">
          <div className="syn-hero-circuit-grid" />
          <div className="syn-hero-circuit-dots" />
          <div className="syn-hero-circuit-vignette" />
          <svg viewBox="0 0 1400 760" className="syn-hero-circuit-lines" preserveAspectRatio="none" aria-hidden>
            <defs>
              <linearGradient id="synteqCircuitStroke" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#38bdf8" />
                <stop offset="55%" stopColor="#60a5fa" />
                <stop offset="100%" stopColor="#5eead4" />
              </linearGradient>
              <radialGradient id="synteqCircuitGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#5eead4" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#5eead4" stopOpacity="0" />
              </radialGradient>
            </defs>

            <g className="syn-hero-trace-layer-base">
              <path d="M30 640 H220 V560 H360 V500 H520 V420 H700 V360 H860" />
              <path d="M0 470 H170 V420 H330 V360 H520 V300 H740 V220 H920" />
              <path d="M200 760 V620 H320 V520 H460 V440 H620 V370 H760" />
              <path d="M1400 650 H1160 V570 H980 V500 H840 V430 H700" />
              <path d="M1400 370 H1220 V320 H1080 V270 H900 V220 H760" />
              <path d="M1220 0 V160 H1120 V260 H1000 V340 H860 V430 H760" />
              <path d="M280 0 V120 H360 V220 H460 V300 H560 V360 H760" />
              <path d="M1020 760 V620 H940 V540 H860 V470 H760" />
              <path d="M80 300 H220 V250 H360 V210 H500 V170 H620" />
              <path d="M1360 120 H1240 V180 H1120 V230 H980 V300 H860" />
              <path d="M760 120 V220 H860 V320 H760 V420 H660 V520 H760" />
              <path d="M560 260 H660 V360 H860" />
            </g>

            <g>
              <path className="syn-hero-trace-flow syn-hero-flow-a" pathLength="100" d="M30 640 H220 V560 H360 V500 H520 V420 H700 V360 H860" />
              <path className="syn-hero-trace-flow syn-hero-flow-b" pathLength="100" d="M0 470 H170 V420 H330 V360 H520 V300 H740 V220 H920" />
              <path className="syn-hero-trace-flow syn-hero-flow-c" pathLength="100" d="M200 760 V620 H320 V520 H460 V440 H620 V370 H760" />
              <path className="syn-hero-trace-flow syn-hero-flow-d" pathLength="100" d="M1400 650 H1160 V570 H980 V500 H840 V430 H700" />
              <path className="syn-hero-trace-flow syn-hero-flow-e" pathLength="100" d="M1400 370 H1220 V320 H1080 V270 H900 V220 H760" />
              <path className="syn-hero-trace-flow syn-hero-flow-f" pathLength="100" d="M1220 0 V160 H1120 V260 H1000 V340 H860 V430 H760" />
              <path className="syn-hero-trace-flow syn-hero-flow-a" pathLength="100" d="M280 0 V120 H360 V220 H460 V300 H560 V360 H760" />
              <path className="syn-hero-trace-flow syn-hero-flow-b" pathLength="100" d="M1020 760 V620 H940 V540 H860 V470 H760" />
              <path className="syn-hero-trace-flow syn-hero-flow-c" pathLength="100" d="M80 300 H220 V250 H360 V210 H500 V170 H620" />
              <path className="syn-hero-trace-flow syn-hero-flow-d" pathLength="100" d="M1360 120 H1240 V180 H1120 V230 H980 V300 H860" />
              <path className="syn-hero-trace-flow syn-hero-flow-e" pathLength="100" d="M760 120 V220 H860 V320 H760 V420 H660 V520 H760" />
              <path className="syn-hero-trace-flow syn-hero-flow-f" pathLength="100" d="M560 260 H660 V360 H860" />
            </g>

            <circle cx="760" cy="360" r="90" fill="url(#synteqCircuitGlow)" opacity="0.65" />
            <circle cx="860" cy="430" r="60" fill="url(#synteqCircuitGlow)" opacity="0.4" />
            <circle cx="620" cy="370" r="54" fill="url(#synteqCircuitGlow)" opacity="0.32" />

            <g>
              <circle className="syn-hero-node syn-hero-node-a" cx="360" cy="500" r="4.2" />
              <circle className="syn-hero-node syn-hero-node-b" cx="520" cy="420" r="4.2" />
              <circle className="syn-hero-node syn-hero-node-c" cx="700" cy="360" r="4.6" />
              <circle className="syn-hero-node syn-hero-node-d" cx="860" cy="430" r="4.8" />
              <circle className="syn-hero-node syn-hero-node-a" cx="760" cy="360" r="5.1" />
              <circle className="syn-hero-node syn-hero-node-b" cx="920" cy="220" r="4.4" />
              <circle className="syn-hero-node syn-hero-node-c" cx="980" cy="500" r="4.4" />
              <circle className="syn-hero-node syn-hero-node-d" cx="1120" cy="260" r="4.4" />
              <circle className="syn-hero-node syn-hero-node-a" cx="1240" cy="180" r="4" />
              <circle className="syn-hero-node syn-hero-node-b" cx="660" cy="520" r="4.2" />
              <circle className="syn-hero-node syn-hero-node-c" cx="560" cy="360" r="4.2" />
              <circle className="syn-hero-node syn-hero-node-d" cx="320" cy="520" r="4.2" />
            </g>
          </svg>
        </div>
        <div className="pointer-events-none absolute left-[12%] top-[16%] h-48 w-48 rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="pointer-events-none absolute right-[8%] top-[8%] h-56 w-56 rounded-full bg-blue-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 right-[-4rem] hidden opacity-20 lg:block">
          <Image
            src="/syn-logo.png"
            alt=""
            width={1024}
            height={1024}
            className="h-[24rem] w-[24rem] object-contain"
            sizes="384px"
          />
        </div>

        <header className="syn-landing-topbar relative z-20">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
              <Image
                src="/syn-logo.png"
                alt="Synteq logo"
                width={1024}
                height={1024}
                priority
                className="h-10 w-10 object-contain drop-shadow-[0_0_14px_rgba(45,212,191,0.35)] sm:h-11 sm:w-11"
                sizes="(max-width: 640px) 40px, 44px"
              />
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-cyan-200/90">Synteq by Lexora</p>
                <p className="bg-gradient-to-r from-cyan-200 via-sky-300 to-teal-200 bg-clip-text text-sm font-semibold text-transparent">
                  DevOps Risk Intelligence
                </p>
              </div>
            </div>
            <nav className="hidden items-center gap-6 text-sm font-medium text-slate-200/90 md:flex">
              <a href="#problem" className="syn-nav-lift hover:text-cyan-200">Problem</a>
              <a href="#how-it-works" className="syn-nav-lift hover:text-cyan-200">Capabilities</a>
              <a href="#dashboard-preview" className="syn-nav-lift hover:text-cyan-200">Dashboard</a>
              <a href="#benefits" className="syn-nav-lift hover:text-cyan-200">Benefits</a>
            </nav>
            {token ? (
              <Link
                href={loginHref}
                className="inline-flex h-10 items-center rounded-xl border border-cyan-300/60 bg-transparent px-4 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/15"
              >
                Open Dashboard
              </Link>
            ) : null}
          </div>
        </header>

        <div className="relative z-10 mx-auto grid w-full max-w-6xl gap-10 px-4 pb-14 pt-8 sm:px-6 lg:grid-cols-12 lg:px-8 lg:pb-24 lg:pt-14">
          <div className="lg:col-span-10">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200/90">DEVOPS RISK DETECTION</p>
            <h1 className="mt-4 max-w-[820px] text-4xl font-semibold leading-[1.06] text-slate-50 sm:text-6xl lg:text-7xl">
              Detect Operational Issues Before They Escalate
            </h1>
            <p className="mt-6 max-w-[680px] text-base leading-7 text-slate-200/90 sm:text-2xl sm:leading-9">
              Synteq continuously analyzes execution signals across your systems, detects abnormal behavior, and surfaces incidents before they impact production.
            </p>
            <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                href={startHref}
                className="syn-cta-lift inline-flex h-12 items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 via-sky-500 to-cyan-400 px-7 text-sm font-semibold text-white shadow-[0_14px_40px_rgba(56,189,248,0.3)]"
              >
                {startLabel}
              </Link>
              <Link
                href={loginHref}
                className="syn-cta-lift inline-flex h-12 items-center justify-center rounded-xl border border-cyan-300/55 bg-slate-900/35 px-7 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/15"
              >
                {token ? "Open Dashboard" : "Log in"}
              </Link>
            </div>
            <ul className="mt-8 grid gap-3 text-sm text-cyan-50/95 sm:grid-cols-3">
              <li className="rounded-xl border border-cyan-300/30 bg-slate-900/40 px-3 py-3 backdrop-blur">Detect instability early</li>
              <li className="rounded-xl border border-cyan-300/30 bg-slate-900/40 px-3 py-3 backdrop-blur">Simulate operational risk</li>
              <li className="rounded-xl border border-cyan-300/30 bg-slate-900/40 px-3 py-3 backdrop-blur">Surface incidents before escalation</li>
            </ul>
          </div>
        </div>
      </section>

      <CircuitDivider />

      <section
        id="problem"
        className="relative overflow-hidden bg-[radial-gradient(circle_at_14%_24%,rgba(45,212,191,0.15),transparent_34%),radial-gradient(circle_at_88%_75%,rgba(59,130,246,0.16),transparent_38%),linear-gradient(180deg,#050c1d_0%,#081329_54%,#0b1b37_100%)]"
      >
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">The Problem</p>
            <h2 className="mt-2 text-3xl font-semibold text-slate-50 sm:text-4xl">Delivery teams are exposed to risk they cannot clearly see</h2>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <article className="rounded-2xl border border-cyan-300/20 bg-slate-950/45 p-5 shadow-[0_20px_48px_rgba(1,6,19,0.45)] backdrop-blur-sm">
              <h3 className="text-lg font-semibold text-cyan-50">Hidden CI/CD risk</h3>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Pipeline instability accumulates quietly across retries, queue delays, and partial failures.
              </p>
            </article>
            <article className="rounded-2xl border border-cyan-300/20 bg-slate-950/45 p-5 shadow-[0_20px_48px_rgba(1,6,19,0.45)] backdrop-blur-sm">
              <h3 className="text-lg font-semibold text-cyan-50">Silent failures</h3>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Teams discover failures too late when weak signals were present but never connected.
              </p>
            </article>
            <article className="rounded-2xl border border-cyan-300/20 bg-slate-950/45 p-5 shadow-[0_20px_48px_rgba(1,6,19,0.45)] backdrop-blur-sm">
              <h3 className="text-lg font-semibold text-cyan-50">Blind spots between deploys</h3>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Critical changes move fast, but confidence drops when no clear risk narrative exists between releases.
              </p>
            </article>
          </div>
        </div>
      </section>

      <CircuitDivider reverse />

      <section
        id="how-it-works"
        className="relative overflow-hidden bg-[radial-gradient(circle_at_80%_18%,rgba(56,189,248,0.15),transparent_35%),linear-gradient(180deg,#071327_0%,#0a1a33_100%)]"
      >
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">What Synteq Does</p>
            <h2 className="mt-2 text-3xl font-semibold text-slate-50 sm:text-4xl">Always-on detection and prevention for operational risk</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Synteq continuously analyzes execution signals across your systems, detects abnormal behavior in real time, and turns weak signals into actionable incidents.
            </p>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {capabilityItems.map((item) => (
              <article
                key={item.title}
                className="rounded-2xl border border-cyan-300/20 bg-[linear-gradient(145deg,rgba(2,8,24,0.82)_0%,rgba(9,23,44,0.74)_100%)] p-6 shadow-[0_20px_52px_rgba(1,6,19,0.42)]"
              >
                <h3 className="text-lg font-semibold text-cyan-50">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">{item.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <CircuitDivider reverse />

      <section
        className="relative overflow-hidden bg-[radial-gradient(circle_at_18%_22%,rgba(56,189,248,0.12),transparent_34%),radial-gradient(circle_at_84%_78%,rgba(45,212,191,0.12),transparent_38%),linear-gradient(180deg,#071327_0%,#0a1a33_100%)]"
      >
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">Built for Trust</p>
            <h2 className="mt-2 text-3xl font-semibold text-slate-50 sm:text-4xl">
              Designed to monitor systems - not access them
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Synteq analyzes execution signals across your systems to detect instability early. We do not access your
              source code, secrets, or full logs by default. Only the minimum operational metadata required for
              detection is processed.
            </p>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <article className="rounded-2xl border border-cyan-300/20 bg-[linear-gradient(145deg,rgba(2,8,24,0.82)_0%,rgba(9,23,44,0.74)_100%)] p-6 shadow-[0_20px_52px_rgba(1,6,19,0.42)]">
              <h3 className="text-lg font-semibold text-cyan-50">What we receive</h3>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-300">
                <li>Workflow and job execution signals</li>
                <li>Timing, retries, and outcomes</li>
                <li>Operational metadata required for detection</li>
              </ul>
            </article>

            <article className="rounded-2xl border border-cyan-300/20 bg-[linear-gradient(145deg,rgba(2,8,24,0.82)_0%,rgba(9,23,44,0.74)_100%)] p-6 shadow-[0_20px_52px_rgba(1,6,19,0.42)]">
              <h3 className="text-lg font-semibold text-cyan-50">What we do not receive by default</h3>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-300">
                <li>Source code</li>
                <li>Secrets</li>
                <li>Full logs</li>
                <li>Artifact contents</li>
              </ul>
            </article>
          </div>

          <p className="mt-6 text-sm text-slate-400">
            Webhook secrets and API keys are used for authentication and verification, not as analysis inputs.
          </p>
        </div>
      </section>

      <CircuitDivider />

      <section
        id="dashboard-preview"
        className="relative overflow-hidden bg-[radial-gradient(circle_at_16%_80%,rgba(56,189,248,0.12),transparent_35%),radial-gradient(circle_at_82%_26%,rgba(45,212,191,0.14),transparent_42%),linear-gradient(180deg,#08152a_0%,#09172d_100%)]"
      >
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">Dashboard Preview</p>
            <h2 className="mt-2 text-3xl font-semibold text-slate-50 sm:text-4xl">One view for score, signal, and incident movement</h2>
          </div>

          <div className="mt-8 grid gap-4 lg:grid-cols-12">
            <article className="rounded-3xl border border-cyan-300/20 bg-[linear-gradient(145deg,rgba(3,11,30,0.9)_0%,rgba(8,24,50,0.78)_100%)] p-6 shadow-[0_22px_60px_rgba(1,6,19,0.48)] lg:col-span-7">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-cyan-200/85">Global Risk</p>
                  <p className="mt-1 text-4xl font-semibold text-cyan-50">78</p>
                </div>
                <span className="rounded-full border border-amber-300/35 bg-amber-300/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-100">
                  Watch
                </span>
              </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-cyan-300/20 bg-slate-950/40 px-3 py-3">
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Failures</p>
                  <p className="mt-1 text-lg font-semibold text-cyan-50">2.8%</p>
                </div>
                <div className="rounded-xl border border-cyan-300/20 bg-slate-950/40 px-3 py-3">
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Retries</p>
                  <p className="mt-1 text-lg font-semibold text-cyan-50">6.2%</p>
                </div>
                <div className="rounded-xl border border-cyan-300/20 bg-slate-950/40 px-3 py-3">
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-400">p95 Latency</p>
                  <p className="mt-1 text-lg font-semibold text-cyan-50">1.9s</p>
                </div>
              </div>
              <div className="mt-6 overflow-hidden rounded-xl border border-cyan-300/20 bg-[linear-gradient(180deg,rgba(15,23,42,0.8)_0%,rgba(2,6,23,0.72)_100%)] p-4">
                <div className="h-40 bg-[linear-gradient(180deg,rgba(56,189,248,0.3)_0%,rgba(14,116,144,0.08)_75%)] [clip-path:polygon(0%_88%,12%_76%,24%_81%,36%_60%,48%_66%,60%_43%,72%_49%,84%_34%,100%_22%,100%_100%,0%_100%)]" />
              </div>
            </article>

            <article className="rounded-3xl border border-cyan-300/25 bg-[linear-gradient(135deg,#081127_0%,#0c1a34_50%,#12264b_100%)] p-6 shadow-[0_18px_60px_rgba(12,18,38,0.45)] lg:col-span-5">
              <p className="text-xs uppercase tracking-[0.2em] text-cyan-200/85">Live Risk Surface</p>
              <div className="mt-4 flex items-end justify-between">
                <div>
                  <p className="text-sm text-slate-300">Platform Risk Score</p>
                  <p className="text-5xl font-semibold text-cyan-100">78</p>
                </div>
                <span className="rounded-full border border-amber-300/40 bg-amber-300/12 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-200">
                  Watch
                </span>
              </div>
              <div className="mt-6 space-y-3 text-sm">
                <div className="rounded-xl border border-cyan-300/25 bg-slate-950/50 px-3 py-3">
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Incident Timeline</p>
                  <p className="mt-1 font-medium text-cyan-100">3 active risk threads in last 30m</p>
                </div>
                <div className="rounded-xl border border-cyan-300/25 bg-slate-950/50 px-3 py-3">
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Latency Drift</p>
                  <p className="mt-1 font-medium text-cyan-100">p95 rising above expected baseline</p>
                </div>
                <div className="rounded-xl border border-cyan-300/25 bg-slate-950/50 px-3 py-3">
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Escalation Risk</p>
                  <p className="mt-1 font-medium text-cyan-100">Medium, with actionable guidance available</p>
                </div>
              </div>
              <div className="mt-5 space-y-2">
                {timelineItems.slice(0, 2).map((item) => (
                  <div key={`${item.time}-${item.label}`} className="flex items-center justify-between text-xs text-slate-300">
                    <p>{item.label}</p>
                    <p className="font-medium text-cyan-200">{item.time}</p>
                  </div>
                ))}
              </div>
            </article>
          </div>
        </div>
      </section>

      <CircuitDivider reverse />

      <section
        id="benefits"
        className="relative overflow-hidden bg-[radial-gradient(circle_at_12%_12%,rgba(45,212,191,0.12),transparent_30%),linear-gradient(180deg,#071122_0%,#0a1831_100%)]"
      >
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">Benefits</p>
            <h2 className="mt-2 text-3xl font-semibold text-slate-50 sm:text-4xl">Built to reduce operational risk, not add observability noise</h2>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {benefitItems.map((item) => (
              <article
                key={item.title}
                className="rounded-2xl border border-cyan-300/20 bg-[linear-gradient(135deg,rgba(2,8,24,0.84)_0%,rgba(7,19,40,0.75)_100%)] p-6 shadow-[0_18px_50px_rgba(1,6,19,0.4)]"
              >
                <h3 className="text-lg font-semibold text-cyan-50">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">{item.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <CircuitDivider />

      <section className="relative overflow-hidden bg-[linear-gradient(180deg,#071226_0%,#091731_100%)]">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="rounded-3xl border border-cyan-300/25 bg-gradient-to-r from-[#081127] via-[#0e2954] to-[#0a6f85] p-8 text-white shadow-[0_20px_65px_rgba(1,6,19,0.5)] sm:p-10">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">Get Started</p>
            <h2 className="mt-2 text-3xl font-semibold sm:text-4xl">Move from blind spots to active risk intelligence</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-cyan-100 sm:text-base">
              Start with the flow your team is ready for, then activate monitoring and simulation in minutes.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link
                href={startHref}
                className="inline-flex h-11 items-center justify-center rounded-xl bg-white px-5 text-sm font-semibold text-ink"
              >
                {startLabel}
              </Link>
              <Link
                href={startHref}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-cyan-200/80 bg-slate-950/20 px-5 text-sm font-semibold text-white transition hover:bg-slate-950/35"
              >
                Connect GitHub
              </Link>
              <Link
                href={simulationHref}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-cyan-200/80 bg-slate-950/20 px-5 text-sm font-semibold text-white transition hover:bg-slate-950/35"
              >
                Run first simulation
              </Link>
            </div>
          </div>
        </div>
      </section>

      <CircuitDivider reverse />

      <footer className="bg-[linear-gradient(180deg,#050a18_0%,#070f21_100%)]">
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-12 lg:px-8">
          <div className="lg:col-span-5">
            <div className="flex items-center gap-3">
              <Image
                src="/syn-logo.png"
                alt="Synteq logo"
                width={1024}
                height={1024}
                className="h-11 w-11 object-contain"
                sizes="44px"
              />
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-cyan-200">Synteq by Lexora</p>
                <p className="text-sm font-semibold text-slate-100">DevOps Risk Intelligence</p>
              </div>
            </div>
            <p className="mt-4 max-w-sm text-sm leading-6 text-slate-300">
              Operational risk intelligence for delivery teams that need clear early warnings before incidents escalate.
            </p>
          </div>

          <div className="grid gap-8 sm:grid-cols-3 lg:col-span-7">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Product</p>
              <div className="mt-3 flex flex-col gap-2 text-sm text-slate-300">
                <a href="#how-it-works" className="hover:text-cyan-100">Capabilities</a>
                <a href="#dashboard-preview" className="hover:text-cyan-100">Dashboard Preview</a>
                <a href="#benefits" className="hover:text-cyan-100">Benefits</a>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Flow</p>
              <div className="mt-3 flex flex-col gap-2 text-sm text-slate-300">
                <Link href={startHref} className="hover:text-cyan-100">{startLabel}</Link>
                <Link href={loginHref} className="hover:text-cyan-100">Login</Link>
                <Link href={simulationHref} className="hover:text-cyan-100">Run First Simulation</Link>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Company</p>
              <div className="mt-3 flex flex-col gap-2 text-sm text-slate-300">
                <a href="#problem" className="hover:text-cyan-100">Why Synteq</a>
                <Link href="/signup" className="hover:text-cyan-100">Sign Up</Link>
                <Link href={loginHref} className="hover:text-cyan-100">Open App</Link>
              </div>
            </div>
          </div>
        </div>
        <div className="border-t border-cyan-400/10">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-4 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
            <p>(c) {new Date().getFullYear()} Synteq. All rights reserved.</p>
            <p>Built for CI/CD reliability and operational risk clarity.</p>
          </div>
        </div>
      </footer>
    </main>
  );
}
