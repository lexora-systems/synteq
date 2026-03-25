"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard error boundary caught", error);
  }, [error]);

  return (
    <main className="min-h-screen syn-app-shell p-6">
      <section className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-panel">
        <p className="text-xs uppercase tracking-[0.2em] text-ember">Dashboard Error</p>
        <h2 className="mt-2 text-2xl font-semibold text-ink">Something failed while loading this page</h2>
        <p className="mt-2 text-sm text-slate-600">{error.message}</p>
        <button
          onClick={() => reset()}
          className="mt-4 rounded-lg bg-ocean px-4 py-2 text-sm font-semibold text-white"
        >
          Retry
        </button>
      </section>
    </main>
  );
}

