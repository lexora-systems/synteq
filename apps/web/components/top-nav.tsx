"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";

type NavItem = {
  href: Route;
  label: string;
  match: (pathname: string) => boolean;
};

export function TopNav() {
  const pathname = usePathname() ?? "";

  const navItems: NavItem[] = [
    {
      href: "/overview",
      label: "Overview",
      match: (path) => path === "/overview"
    },
    {
      href: "/incidents",
      label: "Incidents",
      match: (path) => path === "/incidents" || path.startsWith("/incidents/")
    },
    {
      href: "/settings/profile",
      label: "Profile",
      match: (path) => path === "/profile" || path === "/settings/profile" || path.startsWith("/settings/profile/")
    },
    {
      href: "/settings/tenant",
      label: "Tenant",
      match: (path) => path === "/settings/tenant" || path.startsWith("/settings/tenant/")
    },
    {
      href: "/settings/team",
      label: "Team",
      match: (path) => path === "/settings/team" || path.startsWith("/settings/team/")
    },
    {
      href: "/settings/security",
      label: "Security",
      match: (path) => path === "/settings/security" || path.startsWith("/settings/security/")
    }
  ];

  return (
    <header className="syn-app-topbar sticky top-0 z-20 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3">
        <div>
          <p className="syn-app-brand-accent text-xs uppercase tracking-[0.2em]">Synteq by Lexora</p>
          <h1 className="syn-app-brand-title text-lg font-semibold">Workflow Monitoring</h1>
        </div>
        <nav className="flex items-center gap-4 text-sm font-medium">
          {navItems.map((item) => {
            const isActive = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={`syn-app-topbar-link syn-nav-lift px-1 py-1 ${isActive ? "syn-app-topbar-link-active" : ""}`.trim()}
              >
                {item.label}
              </Link>
            );
          })}
          <form action="/api/logout" method="post">
            <button className="syn-app-topbar-logout rounded-lg border px-3 py-1.5 text-xs uppercase tracking-wide">
              Logout
            </button>
          </form>
        </nav>
      </div>
    </header>
  );
}
