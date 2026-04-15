import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { apiBaseUrl } from "./lib/config";

const GITHUB_SECRET_FLASH_COOKIE = "synteq_github_secret_flash";
const GITHUB_SECRET_FLASH_SEEN_COOKIE = "synteq_github_secret_flash_seen";

function decodeJwtExp(token: string): number | null {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }

  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    const payload = JSON.parse(atob(padded)) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

function isTokenFresh(token: string): boolean {
  const exp = decodeJwtExp(token);
  if (!exp) {
    return false;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  return exp - nowSec > 30;
}

function redirectToLogin() {
  const response = new NextResponse(null, {
    status: 307,
    headers: {
      Location: "/login"
    }
  });
  response.cookies.delete("synteq_token");
  response.cookies.delete("synteq_refresh_token");
  return response;
}

function isGitHubControlPlanePath(pathname: string): boolean {
  return pathname === "/settings/control-plane/github" || pathname === "/settings/control-plane/github/";
}

function isPrefetchRequest(request: NextRequest): boolean {
  if (request.headers.get("next-router-prefetch")) {
    return true;
  }

  const purpose = request.headers.get("purpose");
  return typeof purpose === "string" && purpose.toLowerCase() === "prefetch";
}

function withFlashCookieCleared(request: NextRequest, response: NextResponse): NextResponse {
  if (!isGitHubControlPlanePath(request.nextUrl.pathname) || request.method !== "GET") {
    return response;
  }

  if (isPrefetchRequest(request)) {
    return response;
  }

  const hasFlash = Boolean(request.cookies.get(GITHUB_SECRET_FLASH_COOKIE)?.value);
  const hasSeen = Boolean(request.cookies.get(GITHUB_SECRET_FLASH_SEEN_COOKIE)?.value);

  if (!hasFlash) {
    if (hasSeen) {
      response.cookies.delete(GITHUB_SECRET_FLASH_SEEN_COOKIE);
    }
    return response;
  }

  if (!hasSeen) {
    response.cookies.set(GITHUB_SECRET_FLASH_SEEN_COOKIE, "1", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/settings/control-plane/github",
      maxAge: 120
    });
    return response;
  }

  response.cookies.delete(GITHUB_SECRET_FLASH_COOKIE);
  response.cookies.delete(GITHUB_SECRET_FLASH_SEEN_COOKIE);
  return response;
}

export async function middleware(request: NextRequest) {
  const accessToken = request.cookies.get("synteq_token")?.value;
  if (accessToken && isTokenFresh(accessToken)) {
    return withFlashCookieCleared(request, NextResponse.next());
  }

  const refreshToken = request.cookies.get("synteq_refresh_token")?.value;
  if (!refreshToken) {
    return withFlashCookieCleared(request, redirectToLogin());
  }

  try {
    const refreshResponse = await fetch(`${apiBaseUrl}/v1/auth/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: "no-store"
    });

    if (!refreshResponse.ok) {
      return withFlashCookieCleared(request, redirectToLogin());
    }

    const payload = (await refreshResponse.json()) as {
      token?: string;
      access_token?: string;
      refresh_token?: string;
    };
    const nextAccessToken = payload.access_token ?? payload.token;
    if (!nextAccessToken || !payload.refresh_token) {
      return withFlashCookieCleared(request, redirectToLogin());
    }

    const response = NextResponse.next();
    response.cookies.set("synteq_token", nextAccessToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 15
    });
    response.cookies.set("synteq_refresh_token", payload.refresh_token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30
    });

    return withFlashCookieCleared(request, response);
  } catch {
    return withFlashCookieCleared(request, redirectToLogin());
  }
}

export const config = {
  matcher: [
    "/session-setup/:path*",
    "/welcome/:path*",
    "/overview/:path*",
    "/incidents/:path*",
    "/sources/:path*",
    "/profile/:path*",
    "/settings/:path*",
    "/workflows/:path*"
  ]
};
