import Link from "next/link";

export function TopNav() {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-ocean">Synteq</p>
          <h1 className="text-lg font-semibold text-ink">Workflow Monitoring</h1>
        </div>
        <nav className="flex items-center gap-4 text-sm font-medium text-slate-600">
          <Link href="/overview" className="hover:text-ocean">Overview</Link>
          <Link href="/incidents" className="hover:text-ocean">Incidents</Link>
          <form action="/api/logout" method="post">
            <button className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs uppercase tracking-wide text-slate-700 hover:border-slate-300">
              Logout
            </button>
          </form>
        </nav>
      </div>
    </header>
  );
}
