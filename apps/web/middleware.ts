import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

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

function redirectToLogin(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", request.url));
  response.cookies.delete("synteq_token");
  response.cookies.delete("synteq_refresh_token");
  return response;
}

export async function middleware(request: NextRequest) {
  const accessToken = request.cookies.get("synteq_token")?.value;
  if (accessToken && isTokenFresh(accessToken)) {
    return NextResponse.next();
  }

  const refreshToken = request.cookies.get("synteq_refresh_token")?.value;
  if (!refreshToken) {
    return redirectToLogin(request);
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
      return redirectToLogin(request);
    }

    const payload = (await refreshResponse.json()) as {
      token?: string;
      access_token?: string;
      refresh_token?: string;
    };
    const nextAccessToken = payload.access_token ?? payload.token;
    if (!nextAccessToken || !payload.refresh_token) {
      return redirectToLogin(request);
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

    return response;
  } catch {
    return redirectToLogin(request);
  }
}

export const config = {
  matcher: ["/welcome/:path*", "/overview/:path*", "/incidents/:path*", "/profile/:path*", "/settings/:path*", "/workflows/:path*"]
};
