"use client";

import { useEffect, useMemo, useState } from "react";

const PHASES = [
  "Confirming workspace access...",
  "Loading organization context...",
  "Preparing monitoring surfaces...",
  "Finalizing operator view..."
] as const;

const INITIAL_PROGRESS = 8;
const PROGRESS_CAP = 94;
const PHASE_ADVANCE_MS = 1800;
const PROGRESS_TICK_MS = 180;

function nextProgress(current: number): number {
  if (current >= PROGRESS_CAP) {
    return current;
  }

  const remaining = PROGRESS_CAP - current;
  const step = Math.max(0.12, remaining * 0.028);
  return Math.min(PROGRESS_CAP, current + step);
}

export function WorkspaceSetupLoadingCard() {
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [progress, setProgress] = useState(INITIAL_PROGRESS);
  const [reducedMotion, setReducedMotion] = useState(false);

  const phaseText = useMemo(() => PHASES[phaseIndex], [phaseIndex]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const applyPreference = () => setReducedMotion(mediaQuery.matches);

    applyPreference();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", applyPreference);
      return () => mediaQuery.removeEventListener("change", applyPreference);
    }

    mediaQuery.addListener(applyPreference);
    return () => mediaQuery.removeListener(applyPreference);
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      setProgress(88);
      return;
    }

    const progressInterval = window.setInterval(() => {
      setProgress((current) => nextProgress(current));
    }, PROGRESS_TICK_MS);

    return () => window.clearInterval(progressInterval);
  }, [reducedMotion]);

  useEffect(() => {
    if (reducedMotion) {
      return;
    }

    const phaseInterval = window.setInterval(() => {
      setPhaseIndex((current) => (current + 1) % PHASES.length);
    }, PHASE_ADVANCE_MS);

    return () => window.clearInterval(phaseInterval);
  }, [reducedMotion]);

  return (
    <main className="min-h-screen syn-app-shell px-4 py-8 sm:px-6 sm:py-10">
      <section className="syn-app-panel mx-auto mt-16 w-full max-w-xl rounded-3xl p-6 shadow-panel sm:mt-20 sm:p-7">
        <p className="syn-app-kicker text-xs font-medium uppercase tracking-[0.2em]">Workspace Setup</p>
        <h2 className="syn-app-title mt-2 text-2xl font-semibold">Setting up your workspace</h2>
        <p className="syn-app-copy mt-2 text-sm" aria-live="polite" aria-atomic="true">
          {phaseText}
        </p>

        <div className="mt-6">
          <div
            className="h-2.5 w-full overflow-hidden rounded-full border border-slate-200 bg-white/70"
            role="progressbar"
            aria-label="Workspace setup progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.floor(progress)}
            aria-valuetext={phaseText}
          >
            <div
              className="h-full rounded-full transition-[width] duration-500 ease-out"
              style={{
                width: `${progress}%`,
                background: "var(--syn-app-brand-accent)"
              }}
            />
          </div>

          <div className="mt-2 flex items-center justify-between">
            <p className="syn-app-muted text-xs">Preparing secure operator surfaces</p>
            <p className="syn-app-copy text-xs tabular-nums">{Math.floor(progress)}%</p>
          </div>
        </div>
      </section>
    </main>
  );
}
