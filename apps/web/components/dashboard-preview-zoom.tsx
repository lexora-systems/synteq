"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

export type DashboardPreviewZoomItem = {
  src: string;
  alt: string;
  width: number;
  height: number;
};

const MIN_ZOOM = 1;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.25;
const MODAL_TITLE_ID = "dashboard-preview-zoom-title";

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(2))));
}

function getFocusableElements(container: HTMLElement) {
  const elements = container.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );

  return Array.from(elements).filter((element) => {
    const isVisible = element.offsetWidth > 0 || element.offsetHeight > 0 || element === document.activeElement;
    return isVisible && element.getAttribute("aria-hidden") !== "true";
  });
}

export function DashboardPreviewZoom({ items }: { items: readonly DashboardPreviewZoomItem[] }) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerFocusRef = useRef<HTMLElement | null>(null);
  const selectedItem = selectedIndex === null ? null : items[selectedIndex] ?? null;
  const isZoomed = zoom > MIN_ZOOM;

  const closeModal = useCallback(() => {
    setSelectedIndex(null);
    setZoom(MIN_ZOOM);
    window.requestAnimationFrame(() => triggerFocusRef.current?.focus());
  }, []);

  const openModal = (index: number) => {
    triggerFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedIndex(index);
    setZoom(MIN_ZOOM);
  };

  const zoomIn = () => {
    setZoom((currentZoom) => clampZoom(currentZoom + ZOOM_STEP));
  };

  const zoomOut = () => {
    setZoom((currentZoom) => clampZoom(currentZoom - ZOOM_STEP));
  };

  const resetZoom = () => {
    setZoom(MIN_ZOOM);
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || !dialogRef.current) {
      return;
    }

    const focusableElements = getFocusableElements(dialogRef.current);
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (!firstElement || !lastElement) {
      event.preventDefault();
      return;
    }

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
      return;
    }

    if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  };

  useEffect(() => {
    if (selectedIndex === null) {
      return;
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeModal();
      }
    };

    const originalOverflow = document.body.style.overflow;
    const originalPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = originalOverflow;
      document.body.style.paddingRight = originalPaddingRight;
    };
  }, [closeModal, selectedIndex]);

  return (
    <>
      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        {items.map((item, index) => (
          <article
            key={item.src}
            className="group rounded-3xl border border-cyan-300/20 bg-[linear-gradient(145deg,rgba(3,11,30,0.9)_0%,rgba(8,24,50,0.78)_100%)] p-3 shadow-[0_22px_60px_rgba(1,6,19,0.48)] transition duration-200 hover:-translate-y-0.5 hover:border-cyan-200/45 hover:shadow-[0_26px_72px_rgba(34,211,238,0.2)] focus-within:border-cyan-200/55 focus-within:shadow-[0_26px_72px_rgba(34,211,238,0.22)] sm:p-4"
          >
            <button
              type="button"
              aria-label={`Open enlarged view: ${item.alt}`}
              data-testid={`dashboard-preview-trigger-${index}`}
              className="block w-full cursor-zoom-in rounded-2xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
              onClick={() => openModal(index)}
            >
              <div className="relative flex aspect-[16/9] w-full items-center justify-center overflow-hidden rounded-2xl border border-cyan-300/15 bg-slate-950/35">
                <Image
                  src={item.src}
                  alt={item.alt}
                  width={item.width}
                  height={item.height}
                  className="h-full w-full object-contain transition duration-300 group-hover:scale-[1.015] group-focus-within:scale-[1.015]"
                  sizes="(max-width: 1023px) calc(100vw - 2rem), 544px"
                />
                <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_82%_18%,rgba(34,211,238,0.14),transparent_30%)] opacity-0 transition duration-200 group-hover:opacity-100 group-focus-within:opacity-100" />
                <span
                  className="pointer-events-none absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full border border-cyan-200/35 bg-slate-950/72 text-cyan-100 opacity-[0.85] shadow-[0_0_22px_rgba(34,211,238,0.18)] backdrop-blur transition duration-200 group-hover:border-cyan-100/55 group-hover:bg-slate-900/82 group-hover:opacity-100 group-focus-within:border-cyan-100/55 group-focus-within:opacity-100"
                  data-testid={`dashboard-preview-affordance-${index}`}
                >
                  <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4">
                    <path
                      d="M8.5 4.75H5.75v2.75M15.5 4.75h2.75v2.75M18.25 15.5v2.75H15.5M5.75 15.5v2.75H8.5"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.8"
                    />
                  </svg>
                </span>
              </div>
            </button>
          </article>
        ))}
      </div>

      {selectedItem ? (
        <div className="fixed inset-0 z-50 overflow-hidden px-3 py-4 sm:px-6">
          <div
            className="absolute inset-0 bg-slate-950/88 backdrop-blur-sm"
            aria-hidden="true"
            data-testid="dashboard-preview-backdrop"
            onMouseDown={closeModal}
          />
          <div className="relative z-10 mx-auto flex h-full max-h-[calc(100dvh-2rem)] w-full max-w-6xl items-center">
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={MODAL_TITLE_ID}
              data-testid="dashboard-preview-modal"
              className="flex max-h-full w-full flex-col overflow-hidden rounded-3xl border border-cyan-300/25 bg-[linear-gradient(145deg,rgba(3,9,23,0.98)_0%,rgba(8,24,48,0.96)_100%)] shadow-[0_28px_90px_rgba(0,0,0,0.62),0_0_60px_rgba(34,211,238,0.16)]"
              onKeyDown={handleDialogKeyDown}
            >
              <div className="flex shrink-0 flex-col gap-3 border-b border-cyan-300/15 bg-slate-950/72 p-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:p-4">
                <div className="min-w-0">
                  <h3 id={MODAL_TITLE_ID} className="text-sm font-semibold text-slate-50">
                    Dashboard preview detail
                  </h3>
                  <p className="mt-1 truncate text-xs text-slate-400">{selectedItem.alt}</p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <div className="inline-flex items-center gap-1 rounded-xl border border-cyan-300/20 bg-slate-900/72 p-1 text-xs text-slate-200">
                    <button
                      type="button"
                      className="rounded-lg px-2.5 py-1.5 font-semibold transition hover:bg-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-45"
                      onClick={zoomOut}
                      disabled={zoom <= MIN_ZOOM}
                      aria-label="Zoom out"
                    >
                      Zoom out
                    </button>
                    <span
                      className="min-w-12 px-1 text-center font-semibold text-cyan-100"
                      aria-live="polite"
                      data-testid="dashboard-preview-zoom-level"
                    >
                      {Math.round(zoom * 100)}%
                    </span>
                    <button
                      type="button"
                      className="rounded-lg px-2.5 py-1.5 font-semibold transition hover:bg-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-45"
                      onClick={zoomIn}
                      disabled={zoom >= MAX_ZOOM}
                      aria-label="Zoom in"
                    >
                      Zoom in
                    </button>
                  </div>
                  <button
                    type="button"
                    className="rounded-xl border border-cyan-300/20 bg-slate-900/72 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:bg-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-45"
                    onClick={resetZoom}
                    disabled={zoom === MIN_ZOOM}
                    aria-label="Reset zoom"
                  >
                    Reset
                  </button>
                  <button
                    ref={closeButtonRef}
                    type="button"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-300/25 bg-slate-900/82 text-slate-100 transition hover:bg-cyan-300/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                    onClick={closeModal}
                    aria-label="Close dashboard preview"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4">
                      <path
                        d="m6 6 12 12M18 6 6 18"
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeWidth="2"
                      />
                    </svg>
                  </button>
                </div>
              </div>

              <div
                className="min-h-0 flex-1 overflow-auto overscroll-contain bg-slate-950/62 p-3 sm:p-5"
                data-testid="dashboard-preview-scroll-region"
              >
                <div
                  className={isZoomed ? "w-full shrink-0" : "mx-auto w-full max-w-5xl"}
                  style={isZoomed ? { width: `${zoom * 100}%` } : undefined}
                >
                  <div className="overflow-hidden rounded-2xl border border-cyan-300/20 bg-slate-950/80 shadow-[0_18px_58px_rgba(0,0,0,0.46)]">
                    <Image
                      src={selectedItem.src}
                      alt={selectedItem.alt}
                      width={selectedItem.width}
                      height={selectedItem.height}
                      className="block h-auto w-full"
                      sizes={isZoomed ? `${Math.round(zoom * 100)}vw` : "(max-width: 1023px) calc(100vw - 2rem), 1080px"}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
