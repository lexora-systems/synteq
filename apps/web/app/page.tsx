import Link from "next/link";
import Image from "next/image";
import { getToken } from "../lib/auth";
import { resolveActivationState } from "../lib/activation";

const capabilityItems = [
  {
    title: "Monitors connected workflow activity",
    description: "Tracks execution signals from connected automations, webhooks, and GitHub Actions events to maintain operational visibility across configured sources."
  },
  {
    title: "Detects abnormal operational behavior",
    description: "Identifies failures, retry patterns, latency drift, missing signals, duplicate events, and workflow drift so teams can investigate risk earlier."
  },
  {
    title: "Validates workflow readiness safely",
    description: "Run silent checks for supported workflow sources without creating incidents, alerts, operational events, or reliability noise."
  },
  {
    title: "Surfaces incidents with context",
    description: "Transforms weak operational signals into actionable incidents with severity, timeline context, and investigation visibility."
  }
];

const benefitItems = [
  {
    title: "Detect instability earlier",
    description: "Catch rising failure and retry patterns while there is still time to investigate before small failures escalate."
  },
  {
    title: "Reduce deployment blind spots",
    description: "Spot workflow and CI/CD signal changes between releases so high-impact deploy windows are not flying blind."
  },
  {
    title: "Understand connected workflow risk",
    description: "Give operators and engineering leaders a clear signal from connected workflow events, not just disconnected logs and dashboard noise."
  },
  {
    title: "Reduce time-to-detection",
    description: "Focus teams on the highest-risk workflows with incident context, timelines, and readiness signals."
  }
];

const supportedSourceItems = [
  {
    title: "GitHub Actions",
    description: "Supported through signed GitHub webhooks for workflow and job events. No OAuth or source-code access required."
  },
  {
    title: "Custom webhooks",
    description: "Supported through Synteq's normalized workflow-event contract for webhook-capable systems."
  },
  {
    title: "GoHighLevel",
    description: "Supported through outbound webhooks using the generic webhook path with a GoHighLevel provider marker. No OAuth/API enrichment yet."
  },
  {
    title: "n8n, Make, Zapier",
    description: "Supported when configured to send normalized workflow events. These are webhook/event-contract integrations, not native OAuth apps yet."
  }
];

const problemSourceItems = [
  {
    title: "GitHub Actions",
    description: "Workflow runs, jobs, statuses",
    logo: "/github_logo.png",
    alt: "GitHub logo",
    tone: "blue"
  },
  {
    title: "Webhooks",
    description: "Custom events from any system",
    logo: "/webhook_logo.png",
    alt: "Webhook logo",
    tone: "violet"
  },
  {
    title: "GoHighLevel",
    description: "Outbound webhooks via custom workflow",
    logo: "/GHL-logo.png",
    alt: "GoHighLevel logo",
    tone: "teal"
  },
  {
    title: "n8n / Make / Zapier",
    description: "Send normalized workflow events",
    logo: "/n8n-logo.png",
    alt: "n8n logo",
    tone: "orange"
  },
  {
    title: "Your Systems",
    description: "APIs, backend jobs, scheduled tasks",
    logo: null,
    alt: "",
    tone: "slate"
  }
] as const;

const problemProcessItems = [
  "Normalize & enrich events",
  "Detect anomalies & patterns",
  "Group related signals",
  "Open, update & resolve incidents",
  "Track reliability & alert status"
];

const problemSourceSignalRows = [
  {
    id: "github",
    sourceY: 43,
    coreY: 190,
    gradientId: "problemBlue",
    flowClass: "syn-problem-flow-a",
    nodeClass: "syn-problem-node-a",
    pulseColor: "#60a5fa",
    pulseDelay: "-0.2s"
  },
  {
    id: "webhooks",
    sourceY: 141,
    coreY: 224,
    gradientId: "problemViolet",
    flowClass: "syn-problem-flow-b",
    nodeClass: "syn-problem-node-b",
    pulseColor: "#a78bfa",
    pulseDelay: "-0.9s"
  },
  {
    id: "gohighlevel",
    sourceY: 239,
    coreY: 239,
    gradientId: "problemTeal",
    flowClass: "syn-problem-flow-c",
    nodeClass: "syn-problem-node-c",
    pulseColor: "#67e8f9",
    pulseDelay: "-1.6s"
  },
  {
    id: "automation",
    sourceY: 337,
    coreY: 254,
    gradientId: "problemOrange",
    flowClass: "syn-problem-flow-d",
    nodeClass: "syn-problem-node-d",
    pulseColor: "#fb923c",
    pulseDelay: "-2.3s"
  },
  {
    id: "systems",
    sourceY: 435,
    coreY: 288,
    gradientId: "problemSlate",
    flowClass: "syn-problem-flow-e",
    nodeClass: "syn-problem-node-e",
    pulseColor: "#94a3b8",
    pulseDelay: "-3s"
  }
] as const;

const problemOperationalSignalRows = [
  { id: "overview", coreY: 190, panelY: 80, flowClass: "syn-problem-flow-f", nodeClass: "syn-problem-node-f" },
  { id: "incidents", coreY: 288, panelY: 376, flowClass: "syn-problem-flow-h", nodeClass: "syn-problem-node-b" }
] as const;

const problemCoreInputX = 212;
const problemCoreOutputX = 308;

function problemSourceSignalPath(sourceY: number, coreY: number) {
  return `M0 ${sourceY}H44C118 ${sourceY} 124 ${coreY} ${problemCoreInputX} ${coreY}`;
}

function problemOperationalSignalPath(coreY: number, panelY: number) {
  return `M${problemCoreOutputX} ${coreY}H376C444 ${coreY} 436 ${panelY} 520 ${panelY}`;
}

const problemIncidentItems = [
  {
    title: "Payment workflow failing",
    source: "GoHighLevel - Workflow",
    severity: "High",
    time: "3m ago",
    tone: "rose"
  },
  {
    title: "n8n scenario timeout rate high",
    source: "n8n - Scenario",
    severity: "Medium",
    time: "8m ago",
    tone: "orange"
  },
  {
    title: "GitHub Actions job failing",
    source: "acme/api-deploy.yml",
    severity: "Medium",
    time: "15m ago",
    tone: "amber"
  }
] as const;

const dashboardPreviewItems = [
  {
    src: "/howitworks1.png",
    alt: "Synteq dashboard risk overview preview",
    width: 968,
    height: 531
  },
  {
    src: "/howitworks2.png",
    alt: "Synteq dashboard operational surface preview",
    width: 958,
    height: 438
  }
] as const;

const heroFeatureItems = [
  {
    title: "Detect risk earlier",
    description: "Catch failures, retries, latency drift, and missing signals.",
    icon: "pulse",
    tone: "violet"
  },
  {
    title: "Investigate with context",
    description: "See timelines, root patterns, and impacted workflows in one place.",
    icon: "users",
    tone: "cyan"
  },
  {
    title: "Get the right alerts",
    description: "Notify the right people through email, webhook, and more.",
    icon: "bell",
    tone: "emerald"
  }
] as const;

const heroTrustItems = [
  {
    title: "Designed to monitor systems — not access them.",
    description: "No source code, customer data, secrets, or full logs required.",
    icon: "shield",
    tone: "violet"
  },
  {
    title: "Secure by default",
    description: "Encrypted in transit and at rest. Fine-grained access controls.",
    icon: "lock",
    tone: "indigo"
  },
  {
    title: "Built for automation teams",
    description: "From solo operators to agencies, Synteq scales with your automation stack.",
    icon: "check",
    tone: "emerald"
  },
  {
    title: "Open & extensible",
    description: "Use our API and event contract to connect any tool or workflow.",
    icon: "globe",
    tone: "cyan"
  }
] as const;

function HeroFeatureIcon({ type }: { type: (typeof heroFeatureItems)[number]["icon"] }) {
  if (type === "users") {
    return (
      <svg viewBox="0 0 48 48" aria-hidden className="h-8 w-8">
        <path d="M17 22a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z" fill="none" stroke="currentColor" strokeWidth="3" />
        <path d="M7 36c1.6-6.2 5.1-9 10-9s8.4 2.8 10 9" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="3" />
        <path d="M31 21a5 5 0 1 0-1.7-9.7" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="3" />
        <path d="M30 28c5.2.4 8.7 3.2 10 8" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="3" />
      </svg>
    );
  }

  if (type === "bell") {
    return (
      <svg viewBox="0 0 48 48" aria-hidden className="h-8 w-8">
        <path
          d="M15 22c0-6.1 3.6-10 9-10s9 3.9 9 10v6l4 6H11l4-6v-6Z"
          fill="none"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="3"
        />
        <path d="M21 38c.8 1.6 1.8 2.4 3 2.4s2.2-.8 3-2.4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="3" />
        <path d="M24 8v3" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="3" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 48 48" aria-hidden className="h-8 w-8">
      <path
        d="M6 25h9l4-13 8 26 4-17h11"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3"
      />
    </svg>
  );
}

function HeroTrustIcon({ type }: { type: (typeof heroTrustItems)[number]["icon"] }) {
  if (type === "lock") {
    return (
      <svg viewBox="0 0 40 40" aria-hidden className="h-6 w-6">
        <path d="M12 18v-4c0-5 3.2-8 8-8s8 3 8 8v4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.5" />
        <path d="M10 18h20v16H10V18Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="2.5" />
        <path d="M20 25v4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.5" />
      </svg>
    );
  }

  if (type === "check") {
    return (
      <svg viewBox="0 0 40 40" aria-hidden className="h-6 w-6">
        <circle cx="20" cy="20" r="12" fill="none" stroke="currentColor" strokeWidth="2.5" />
        <path d="m14 20 4 4 8-9" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
      </svg>
    );
  }

  if (type === "globe") {
    return (
      <svg viewBox="0 0 40 40" aria-hidden className="h-6 w-6">
        <circle cx="20" cy="20" r="13" fill="none" stroke="currentColor" strokeWidth="2.5" />
        <path d="M7 20h26M20 7c4 4.4 6 8.7 6 13s-2 8.6-6 13M20 7c-4 4.4-6 8.7-6 13s2 8.6 6 13" fill="none" stroke="currentColor" strokeWidth="2.5" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 40 40" aria-hidden className="h-6 w-6">
      <path d="M20 5 31 9v9c0 7.3-4 12.7-11 17-7-4.3-11-9.7-11-17V9l11-4Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="2.5" />
      <path d="M16 20.5 19 23l6-7" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
    </svg>
  );
}

function ProblemSystemIcon() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden className="h-7 w-7">
      <path d="m15 13-7 7 7 7" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
      <path d="m25 13 7 7-7 7" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
      <path d="m22 10-4 20" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.5" />
    </svg>
  );
}

function ProblemCheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="m8 12 2.6 2.6L16 9" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

export default async function PublicLandingPage() {
  const token = await getToken();
  const activation = token ? await resolveActivationState(token) : null;
  const isActivated = Boolean(activation?.activated && !activation?.metricsUnavailable);
  const publicSignupEnabled = process.env.NEXT_PUBLIC_ALLOW_PUBLIC_SIGNUP !== "false";
  const startHref = token ? (isActivated ? "/overview" : "/welcome") : publicSignupEnabled ? "/signup" : "/login";
  const startLabel = token ? (isActivated ? "Open Dashboard" : "Create Workspace") : publicSignupEnabled ? "Create Workspace" : "Log In";
  const loginHref = token ? "/overview" : "/login";
  const githubWebhookHref = token ? "/settings/control-plane/github" : "/login";
  const readinessHref = token ? "/sources" : "/login";

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
                  Workflow Reliability Intelligence
                </p>
              </div>
            </div>
            <nav className="hidden items-center gap-6 text-sm font-medium text-slate-200/90 md:flex">
              <a href="#problem" className="syn-nav-lift hover:text-cyan-200">Problem</a>
              <a href="#how-it-works" className="syn-nav-lift hover:text-cyan-200">Capabilities</a>
              <a href="#sources" className="syn-nav-lift hover:text-cyan-200">Sources</a>
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

        <div className="relative z-10 mx-auto grid w-full max-w-6xl gap-10 px-4 pb-10 pt-7 sm:px-6 lg:grid-cols-12 lg:px-8 lg:pb-16 lg:pt-10">
          <div className="lg:col-span-10">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200/90">WORKFLOW RELIABILITY INFRASTRUCTURE</p>
            <h1 className="mt-3 max-w-[960px] text-4xl font-semibold leading-[1.06] text-slate-50 sm:text-6xl lg:text-[4.35rem] xl:text-7xl">
              Monitor Reliability Across Your Workflow and Automation Signals
            </h1>
            <p className="mt-5 max-w-[680px] text-base leading-7 text-slate-200/90 sm:text-xl sm:leading-8">
              Synteq helps teams detect failures, retries, latency drift, missing signals, and operational risk from connected workflow, webhook, and GitHub Actions events.
            </p>
            <div className="mt-8 grid max-w-5xl gap-5 sm:grid-cols-3">
              {heroFeatureItems.map((item) => (
                <article key={item.title} className="min-w-0">
                  <div
                    className={[
                      "flex h-12 w-12 items-center justify-center rounded-2xl border shadow-[0_18px_42px_rgba(2,6,23,0.28)]",
                      item.tone === "violet"
                        ? "border-violet-400/15 bg-violet-500/15 text-violet-400"
                        : item.tone === "cyan"
                          ? "border-cyan-400/15 bg-cyan-500/15 text-cyan-300"
                          : "border-emerald-400/15 bg-emerald-500/15 text-emerald-300"
                    ].join(" ")}
                  >
                    <HeroFeatureIcon type={item.icon} />
                  </div>
                  <h2 className="mt-4 text-base font-semibold text-slate-50">{item.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-300">{item.description}</p>
                </article>
              ))}
            </div>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
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
          </div>
        </div>
      </section>

      <section
        id="problem"
        className="relative overflow-hidden bg-[radial-gradient(circle_at_18%_20%,rgba(45,212,191,0.13),transparent_34%),radial-gradient(circle_at_56%_48%,rgba(124,58,237,0.18),transparent_28%),radial-gradient(circle_at_88%_72%,rgba(59,130,246,0.16),transparent_36%),linear-gradient(135deg,#030815_0%,#071123_48%,#0a1730_100%)]"
      >
        <div className="syn-problem-field pointer-events-none absolute inset-0" aria-hidden>
          <div className="syn-problem-grid" />
          <div className="syn-problem-sparks" />
        </div>
        <div className="pointer-events-none absolute left-[32%] top-[36%] h-64 w-64 rounded-full bg-blue-500/20 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute right-[28%] top-[30%] h-60 w-60 rounded-full bg-violet-500/20 blur-3xl" aria-hidden />

        <div className="relative mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
          <h2 className="sr-only">The Problem: disconnected operational signals create workflow reliability blind spots</h2>
          <div className="grid gap-5 lg:grid-cols-[minmax(250px,300px)_minmax(340px,430px)_minmax(310px,400px)] lg:items-start lg:justify-center xl:gap-6">
            <div className="relative z-10">
              <p className="mb-4 text-xs font-semibold uppercase leading-4 tracking-[0.24em] text-sky-300">Your Sources</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                {problemSourceItems.map((source) => (
                  <article
                    key={source.title}
                    className="group flex min-h-[86px] items-center gap-3 rounded-2xl border border-cyan-300/15 bg-slate-950/60 p-3.5 shadow-[0_18px_42px_rgba(2,6,23,0.35)] backdrop-blur-sm transition duration-200 hover:-translate-y-0.5 hover:border-cyan-300/35 hover:bg-slate-950/75 lg:h-[86px] lg:p-3"
                  >
                    <div
                      className={[
                        "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border shadow-[0_0_28px_rgba(56,189,248,0.16)]",
                        source.tone === "blue"
                          ? "border-blue-400/25 bg-blue-500/12 text-blue-200"
                          : source.tone === "violet"
                            ? "border-violet-400/25 bg-violet-500/12 text-violet-200"
                            : source.tone === "teal"
                              ? "border-teal-300/25 bg-teal-400/12 text-teal-200"
                              : source.tone === "orange"
                                ? "border-orange-300/25 bg-orange-400/12 text-orange-200"
                                : "border-sky-300/20 bg-sky-500/10 text-sky-200"
                      ].join(" ")}
                    >
                      {source.logo ? (
                        <Image
                          src={source.logo}
                          alt={source.alt}
                          width={48}
                          height={48}
                          className="h-8 w-8 object-contain"
                          sizes="32px"
                        />
                      ) : (
                        <ProblemSystemIcon />
                      )}
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold leading-5 text-slate-50">{source.title}</h3>
                      <p className="mt-1 text-xs leading-4 text-slate-300">{source.description}</p>
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <div className="relative z-10 min-h-[430px] overflow-hidden rounded-[1.75rem] border border-cyan-300/10 bg-slate-950/20 p-5 lg:h-[510px] lg:min-h-0 lg:overflow-visible lg:border-0 lg:bg-transparent lg:p-0">
              <p className="absolute left-5 top-5 z-20 text-xs font-semibold uppercase leading-4 tracking-[0.24em] text-cyan-300 lg:left-0 lg:top-0">
                Signals In
              </p>
              <div className="pointer-events-none absolute left-1/2 top-12 h-16 w-px -translate-x-1/2 bg-gradient-to-b from-cyan-300/0 via-cyan-300/70 to-violet-300/0 lg:hidden" aria-hidden />
              <svg
                viewBox="0 0 520 478"
                preserveAspectRatio="none"
                className="syn-problem-flow absolute -left-6 top-8 z-10 hidden h-[478px] w-[calc(100%+3rem)] lg:block"
                aria-hidden
              >
                <defs>
                  <linearGradient id="problemBlue" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#2563eb" />
                    <stop offset="100%" stopColor="#60a5fa" />
                  </linearGradient>
                  <linearGradient id="problemViolet" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#7c3aed" />
                    <stop offset="100%" stopColor="#a78bfa" />
                  </linearGradient>
                  <linearGradient id="problemTeal" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#2dd4bf" />
                    <stop offset="100%" stopColor="#67e8f9" />
                  </linearGradient>
                  <linearGradient id="problemOrange" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#fb923c" />
                    <stop offset="100%" stopColor="#f97316" />
                  </linearGradient>
                  <linearGradient id="problemSlate" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#64748b" />
                    <stop offset="100%" stopColor="#94a3b8" />
                  </linearGradient>
                  <linearGradient id="problemPurpleOut" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#a855f7" />
                    <stop offset="100%" stopColor="#c084fc" />
                  </linearGradient>
                  <radialGradient id="problemCenterGlow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#7dd3fc" stopOpacity="0.34" />
                    <stop offset="42%" stopColor="#7c3aed" stopOpacity="0.28" />
                    <stop offset="70%" stopColor="#38bdf8" stopOpacity="0.1" />
                    <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
                  </radialGradient>
                </defs>

                <circle cx="260" cy="239" r="170" fill="url(#problemCenterGlow)" />
                <g className="syn-problem-flow-base">
                  {problemSourceSignalRows.map((row) => (
                    <path key={`source-base-${row.id}`} d={problemSourceSignalPath(row.sourceY, row.coreY)} />
                  ))}
                  {problemOperationalSignalRows.map((row) => (
                    <path key={`operational-base-${row.id}`} d={problemOperationalSignalPath(row.coreY, row.panelY)} />
                  ))}
                </g>
                <g>
                  {problemSourceSignalRows.map((row) => (
                    <path
                      key={`source-flow-${row.id}`}
                      className={`syn-problem-flow-path ${row.flowClass}`}
                      pathLength="100"
                      stroke={`url(#${row.gradientId})`}
                      d={problemSourceSignalPath(row.sourceY, row.coreY)}
                    />
                  ))}
                  {problemOperationalSignalRows.map((row) => (
                    <path
                      key={`operational-flow-${row.id}`}
                      className={`syn-problem-flow-path ${row.flowClass}`}
                      pathLength="100"
                      stroke="url(#problemPurpleOut)"
                      d={problemOperationalSignalPath(row.coreY, row.panelY)}
                    />
                  ))}
                </g>
                <g className="syn-problem-runner-layer">
                  {problemSourceSignalRows.map((row) => (
                    <g key={`source-runner-${row.id}`} className="syn-problem-runner" style={{ color: row.pulseColor }}>
                      <circle className="syn-problem-runner-halo" r="7" />
                      <circle className="syn-problem-runner-core" r="3.4" />
                      <animateMotion
                        dur="3.8s"
                        begin={row.pulseDelay}
                        repeatCount="indefinite"
                        path={problemSourceSignalPath(row.sourceY, row.coreY)}
                      />
                    </g>
                  ))}
                </g>
                <g className="syn-problem-endpoint-layer">
                  {problemSourceSignalRows.map((row) => (
                    <circle key={`source-node-${row.id}`} className={`syn-problem-node ${row.nodeClass}`} cx="0" cy={row.sourceY} r="5" />
                  ))}
                  {problemOperationalSignalRows.map((row) => (
                    <circle key={`panel-node-${row.id}`} className={`syn-problem-node ${row.nodeClass}`} cx="520" cy={row.panelY} r="5" />
                  ))}
                </g>
              </svg>

              <div className="syn-problem-core-light pointer-events-none absolute left-1/2 top-[230px] z-0 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 sm:top-[260px] sm:h-[340px] sm:w-[340px] lg:top-[263px] lg:h-[410px] lg:w-[410px]" aria-hidden />
              <div className="relative z-20 mx-auto mt-20 max-w-[300px] pt-16 text-center sm:pt-20 lg:absolute lg:left-1/2 lg:top-[263px] lg:mt-0 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:pt-[11.5rem]">
                <div className="syn-problem-core mx-auto flex h-36 w-36 items-center justify-center sm:h-40 sm:w-40 lg:h-44 lg:w-44">
                  <Image
                    src="/syn-logo.png"
                    alt="Synteq mark"
                    width={1024}
                    height={1024}
                    className="syn-problem-logo relative z-10 h-24 w-24 object-contain sm:h-28 sm:w-28 lg:h-32 lg:w-32"
                    sizes="(max-width: 640px) 96px, (max-width: 1023px) 112px, 128px"
                  />
                </div>
                <ul className="mt-3 grid gap-2 text-left text-sm leading-5 text-slate-300 lg:mt-4">
                  {problemProcessItems.map((item) => (
                    <li key={item} className="flex items-center gap-2">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-blue-300">
                        <ProblemCheckIcon />
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="relative z-10 space-y-3 xl:space-y-4">
              <article className="rounded-2xl border border-violet-400/35 bg-slate-950/62 p-3.5 shadow-[0_20px_54px_rgba(12,5,40,0.32)] backdrop-blur-md xl:p-4">
                <h3 className="text-base font-semibold text-slate-50">Operational Overview</h3>
                <div className="mt-3 grid grid-cols-2 gap-2 xl:grid-cols-4">
                  <div className="rounded-xl border border-slate-700/60 bg-slate-900/60 p-2.5">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Active Incidents</p>
                    <div className="mt-1.5 flex items-end gap-2">
                      <span className="text-xl font-semibold text-slate-50">12</span>
                      <span className="pb-1 text-xs font-semibold text-rose-300">+20%</span>
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-700/60 bg-slate-900/60 p-2.5">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Impacted Workflows</p>
                    <p className="mt-1.5 text-xl font-semibold text-slate-50">8</p>
                  </div>
                  <div className="rounded-xl border border-slate-700/60 bg-slate-900/60 p-2.5">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Error rate (24h)</p>
                    <div className="mt-1.5 flex items-end justify-between gap-2">
                      <span className="text-xl font-semibold text-slate-50">2.7%</span>
                      <svg viewBox="0 0 74 28" aria-hidden className="h-7 w-16 text-blue-400">
                        <path d="M2 22 10 18 18 20 26 13 34 15 42 9 50 12 58 5 72 8" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                      </svg>
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-700/60 bg-slate-900/60 p-2.5">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">MTTR (24h)</p>
                    <p className="mt-1.5 text-xl font-semibold text-slate-50">28m</p>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
                  <div className="rounded-xl border border-slate-700/55 bg-slate-900/45 p-2.5">
                    <svg viewBox="0 0 360 132" className="h-[112px] w-full" aria-label="Incident trend chart">
                      <g stroke="rgba(148,163,184,0.14)" strokeWidth="1">
                        <path d="M0 30H360" />
                        <path d="M0 70H360" />
                        <path d="M0 110H360" />
                        <path d="M45 0V126" />
                        <path d="M135 0V126" />
                        <path d="M225 0V126" />
                        <path d="M315 0V126" />
                      </g>
                      <path
                        d="M8 112 28 96 46 72 64 88 86 58 108 45 126 34 142 43 160 25 176 59 194 75 214 70 232 82 248 52 266 65 284 92 304 86 326 108 350 100"
                        fill="none"
                        stroke="#3b82f6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="4"
                      />
                      <circle cx="248" cy="52" r="9" fill="#ef4444" />
                      <text x="248" y="56" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">A</text>
                      <g fill="rgba(203,213,225,0.65)" fontSize="11">
                        <text x="0" y="128">00:00</text>
                        <text x="92" y="128">06:00</text>
                        <text x="182" y="128">12:00</text>
                        <text x="272" y="128">18:00</text>
                        <text x="332" y="128">24:00</text>
                      </g>
                    </svg>
                  </div>

                  <div className="rounded-xl border border-slate-700/55 bg-slate-900/45 p-2.5">
                    <p className="text-xs font-semibold text-slate-200">Events (24h)</p>
                    <div className="mt-2 grid grid-cols-[70px_1fr] items-center gap-2.5">
                      <div className="relative h-[68px] w-[68px] rounded-full bg-[conic-gradient(#22c55e_0_68%,#f97316_68%_86%,#ef4444_86%_96%,#64748b_96%_100%)]">
                        <div className="absolute inset-3 rounded-full bg-slate-950" />
                      </div>
                      <div className="space-y-1.5 text-[11px] text-slate-300">
                        <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-400" />Success</span><span>68%</span></div>
                        <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-orange-400" />Failed</span><span>18%</span></div>
                        <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-rose-400" />Retry</span><span>10%</span></div>
                        <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-slate-500" />Other</span><span>4%</span></div>
                      </div>
                    </div>
                  </div>
                </div>
              </article>

              <article className="rounded-2xl border border-violet-400/35 bg-slate-950/62 p-3.5 shadow-[0_20px_54px_rgba(12,5,40,0.32)] backdrop-blur-md xl:p-4">
                <h3 className="text-base font-semibold text-slate-50">Active Incidents</h3>
                <div className="mt-3 divide-y divide-slate-700/45 rounded-xl border border-slate-700/55 bg-slate-900/35">
                  {problemIncidentItems.map((incident) => (
                    <div key={incident.title} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                      <div className="col-span-2 flex min-w-0 items-center gap-3 sm:col-span-1">
                        <span
                          className={[
                            "h-3 w-3 shrink-0 rounded-full",
                            incident.tone === "rose" ? "bg-rose-400" : incident.tone === "orange" ? "bg-orange-400" : "bg-amber-400"
                          ].join(" ")}
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-50">{incident.title}</p>
                          <p className="truncate text-xs text-slate-400">{incident.source}</p>
                        </div>
                      </div>
                      <span className={incident.tone === "rose" ? "text-xs font-semibold text-rose-300" : "text-xs font-semibold text-amber-300"}>
                        {incident.severity}
                      </span>
                      <span className="text-xs text-slate-300">{incident.time}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-right text-xs font-medium text-slate-300">View all incidents -&gt;</p>
              </article>

            </div>

            <div className="relative z-10 grid gap-4 rounded-2xl border border-cyan-300/10 bg-slate-950/52 p-4 shadow-[0_24px_70px_rgba(2,6,23,0.38)] backdrop-blur-md sm:grid-cols-2 lg:col-span-3 lg:grid-cols-4 lg:p-5">
              {heroTrustItems.map((item) => (
                <article key={item.title} className="flex min-w-0 gap-3">
                  <div
                    className={[
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border",
                      item.tone === "violet"
                        ? "border-violet-400/15 bg-violet-500/15 text-violet-300"
                        : item.tone === "indigo"
                          ? "border-indigo-400/15 bg-indigo-500/15 text-indigo-300"
                          : item.tone === "emerald"
                            ? "border-emerald-400/15 bg-emerald-500/15 text-emerald-300"
                            : "border-cyan-400/15 bg-cyan-500/15 text-cyan-300"
                    ].join(" ")}
                  >
                    <HeroTrustIcon type={item.icon} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold leading-5 text-slate-50">{item.title}</h3>
                    <p className="mt-1 text-xs leading-5 text-slate-300">{item.description}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section
        id="how-it-works"
        className="relative overflow-hidden bg-[radial-gradient(circle_at_80%_18%,rgba(56,189,248,0.15),transparent_35%),linear-gradient(180deg,#071327_0%,#0a1a33_100%)]"
      >
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">WHAT SYNTEQ DOES</p>
            <h2 className="mt-2 text-3xl font-semibold text-slate-50 sm:text-4xl">Operational intelligence for workflow reliability</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Synteq monitors connected workflow, webhook, and GitHub Actions signals, then turns abnormal behavior into actionable incidents and reliability context.
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
      <section
        id="sources"
        className="relative overflow-hidden bg-[radial-gradient(circle_at_18%_22%,rgba(56,189,248,0.13),transparent_34%),radial-gradient(circle_at_82%_74%,rgba(45,212,191,0.12),transparent_38%),linear-gradient(180deg,#071327_0%,#0a1a33_100%)]"
      >
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">Current Supported Sources</p>
            <h2 className="mt-2 text-3xl font-semibold text-slate-50 sm:text-4xl">Connect the signals Synteq supports today</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Synteq supports operational signals from GitHub Actions and webhook-capable automation tools. Some sources are first-class webhooks; others connect by sending Synteq's normalized workflow-event contract.
            </p>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {supportedSourceItems.map((item) => (
              <article
                key={item.title}
                className="rounded-2xl border border-cyan-300/20 bg-[linear-gradient(145deg,rgba(2,8,24,0.82)_0%,rgba(9,23,44,0.74)_100%)] p-6 shadow-[0_20px_52px_rgba(1,6,19,0.42)]"
              >
                <h3 className="text-lg font-semibold text-cyan-50">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">{item.description}</p>
              </article>
            ))}
          </div>

          <div className="mt-6 rounded-2xl border border-amber-300/25 bg-amber-300/10 p-5 text-sm leading-6 text-amber-50">
            <p className="font-semibold">Not currently included</p>
            <p className="mt-1 text-amber-100/90">
              Synteq is not currently a full APM, SIEM, log search platform, marketplace app, or native OAuth integration hub.
            </p>
          </div>
        </div>
      </section>

      <section
        className="relative overflow-hidden bg-[radial-gradient(circle_at_18%_22%,rgba(56,189,248,0.12),transparent_34%),radial-gradient(circle_at_84%_78%,rgba(45,212,191,0.12),transparent_38%),linear-gradient(180deg,#071327_0%,#0a1a33_100%)]"
      >
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">Built for Trust</p>
            <h2 className="mt-2 text-3xl font-semibold text-slate-50 sm:text-4xl">
              Designed to monitor systems — not access them
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Synteq works from operational signals to help teams investigate risk earlier, before small failures escalate.
              It does not require source code, customer records, secrets, or full logs by default. Only the minimum
              operational metadata required for detection is processed.
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
                <li>Customer records</li>
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

      <section
        id="dashboard-preview"
        className="relative overflow-hidden bg-[radial-gradient(circle_at_16%_80%,rgba(56,189,248,0.12),transparent_35%),radial-gradient(circle_at_82%_26%,rgba(45,212,191,0.14),transparent_42%),linear-gradient(180deg,#08152a_0%,#09172d_100%)]"
      >
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">Dashboard Preview</p>
            <h2 className="mt-2 text-3xl font-semibold text-slate-50 sm:text-4xl">One view for score, signal, and incident movement</h2>
          </div>

          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            {dashboardPreviewItems.map((item) => (
              <article
                key={item.src}
                className="rounded-3xl border border-cyan-300/20 bg-[linear-gradient(145deg,rgba(3,11,30,0.9)_0%,rgba(8,24,50,0.78)_100%)] p-3 shadow-[0_22px_60px_rgba(1,6,19,0.48)] sm:p-4"
              >
                <div className="flex aspect-[16/9] w-full items-center justify-center overflow-hidden rounded-2xl border border-cyan-300/15 bg-slate-950/35">
                  <Image
                    src={item.src}
                    alt={item.alt}
                    width={item.width}
                    height={item.height}
                    className="h-full w-full object-contain"
                    sizes="(max-width: 1023px) calc(100vw - 2rem), 544px"
                  />
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="benefits"
        className="relative overflow-hidden bg-[radial-gradient(circle_at_12%_12%,rgba(45,212,191,0.12),transparent_30%),linear-gradient(180deg,#071122_0%,#0a1831_100%)]"
      >
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">Benefits</p>
            <h2 className="mt-2 text-3xl font-semibold text-slate-50 sm:text-4xl">Built to reduce operational risk, not add dashboard noise</h2>
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

      <section className="relative overflow-hidden bg-[linear-gradient(180deg,#071226_0%,#091731_100%)]">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="rounded-3xl border border-cyan-300/25 bg-gradient-to-r from-[#081127] via-[#0e2954] to-[#0a6f85] p-8 text-white shadow-[0_20px_65px_rgba(1,6,19,0.5)] sm:p-10">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">Get Started</p>
            <h2 className="mt-2 text-3xl font-semibold sm:text-4xl">Move from blind spots to connected signal intelligence</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-cyan-100 sm:text-base">
              Start with the source your team is ready for, then connect signals and validate webhook readiness.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link
                href={startHref}
                className="inline-flex h-11 items-center justify-center rounded-xl bg-white px-5 text-sm font-semibold text-ink"
              >
                {startLabel}
              </Link>
              <Link
                href={githubWebhookHref}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-cyan-200/80 bg-slate-950/20 px-5 text-sm font-semibold text-white transition hover:bg-slate-950/35"
              >
                Set up GitHub webhook
              </Link>
              <Link
                href={readinessHref}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-cyan-200/80 bg-slate-950/20 px-5 text-sm font-semibold text-white transition hover:bg-slate-950/35"
              >
                Test source readiness
              </Link>
            </div>
          </div>
        </div>
      </section>

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
                <p className="text-sm font-semibold text-slate-100">Workflow Reliability Intelligence</p>
              </div>
            </div>
            <p className="mt-4 max-w-sm text-sm leading-6 text-slate-300">
              Operational risk intelligence for teams that need clear signals before small workflow failures escalate.
            </p>
          </div>

          <div className="grid gap-8 sm:grid-cols-3 lg:col-span-7">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Product</p>
              <div className="mt-3 flex flex-col gap-2 text-sm text-slate-300">
                <a href="#how-it-works" className="hover:text-cyan-100">Capabilities</a>
                <a href="#sources" className="hover:text-cyan-100">Sources</a>
                <a href="#dashboard-preview" className="hover:text-cyan-100">Dashboard Preview</a>
                <a href="#benefits" className="hover:text-cyan-100">Benefits</a>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Flow</p>
              <div className="mt-3 flex flex-col gap-2 text-sm text-slate-300">
                <Link href={startHref} className="hover:text-cyan-100">{startLabel}</Link>
                <Link href={loginHref} className="hover:text-cyan-100">Login</Link>
                <Link href={readinessHref} className="hover:text-cyan-100">Test Source Readiness</Link>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Company</p>
              <div className="mt-3 flex flex-col gap-2 text-sm text-slate-300">
                <a href="#problem" className="hover:text-cyan-100">Why Synteq</a>
                <Link href="/signup" className="hover:text-cyan-100">{publicSignupEnabled ? "Sign Up" : "Early Access"}</Link>
                <Link href={loginHref} className="hover:text-cyan-100">Open App</Link>
                <Link href="/privacy" className="hover:text-cyan-100">Privacy</Link>
                <Link href="/terms" className="hover:text-cyan-100">Terms</Link>
                <Link href="/trust" className="hover:text-cyan-100">Trust</Link>
              </div>
            </div>
          </div>
        </div>
        <div className="border-t border-cyan-400/10">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-4 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
            <p>(c) {new Date().getFullYear()} Synteq. All rights reserved.</p>
            <p>Built for workflow, webhook, and CI/CD reliability clarity.</p>
          </div>
        </div>
      </footer>
    </main>
  );
}
