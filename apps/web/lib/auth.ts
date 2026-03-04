import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { apiBaseUrl } from "./config";

function decodeJwtExp(token: string): number | null {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { exp?: number };
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

async function refreshSession(refreshToken: string) {
  const response = await fetch(`${apiBaseUrl}/v1/auth/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
    cache: "no-store"
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as { token?: string; access_token?: string; refresh_token?: string };
  const accessToken = payload.access_token ?? payload.token;
  if (!accessToken || !payload.refresh_token) {
    return null;
  }

  return {
    accessToken,
    refreshToken: payload.refresh_token
  };
}

export async function getToken() {
  const cookieStore = await cookies();
  return cookieStore.get("synteq_token")?.value;
}

export async function requireToken() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("synteq_token")?.value;
  const refreshToken = cookieStore.get("synteq_refresh_token")?.value;

  if (accessToken && isTokenFresh(accessToken)) {
    return accessToken;
  }

  if (!refreshToken) {
    redirect("/login");
  }

  const refreshed = await refreshSession(refreshToken);
  if (!refreshed) {
    cookieStore.delete("synteq_token");
    cookieStore.delete("synteq_refresh_token");
    redirect("/login");
  }

  cookieStore.set("synteq_token", refreshed.accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 15
  });
  cookieStore.set("synteq_refresh_token", refreshed.refreshToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });

  return refreshed.accessToken;
}
