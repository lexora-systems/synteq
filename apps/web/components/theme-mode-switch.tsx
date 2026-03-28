"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type SynTheme = "light" | "dark";

const STORAGE_KEY = "synteq-theme";

function applyTheme(theme: SynTheme) {
  document.documentElement.setAttribute("data-syn-theme", theme);
}

export function ThemeModeSwitch() {
  const pathname = usePathname();
  const [theme, setTheme] = useState<SynTheme>("light");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    const next: SynTheme = saved === "dark" ? "dark" : "light";
    setTheme(next);
    applyTheme(next);
  }, []);

  function updateTheme(next: SynTheme) {
    setTheme(next);
    applyTheme(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }

  if (pathname === "/") {
    return null;
  }

  return (
    <div className="syn-theme-switch" data-theme={theme} role="group" aria-label="Theme mode">
      <span className="syn-theme-switch-thumb" aria-hidden />
      <button
        type="button"
        className={`syn-theme-switch-btn ${theme === "light" ? "is-active" : ""}`}
        onClick={() => updateTheme("light")}
      >
        Light
      </button>
      <button
        type="button"
        className={`syn-theme-switch-btn ${theme === "dark" ? "is-active" : ""}`}
        onClick={() => updateTheme("dark")}
      >
        Dark
      </button>
    </div>
  );
}
