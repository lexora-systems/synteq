import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { apiBaseUrl } from "./config";

type RefreshSessionResult =
  | {
      ok: true;
      accessToken: string;
      refreshToken: string;
    }
  | {
      ok: false;
      code: string;
    };

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

async function refreshSession(refreshToken: string): Promise<RefreshSessionResult> {
  try {
    const response = await fetch(`${apiBaseUrl}/v1/auth/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: "no-store"
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { code?: string };
      return {
        ok: false,
        code: body.code ?? "AUTH_REFRESH_FAILED"
      };
    }

    const payload = (await response.json()) as { token?: string; access_token?: string; refresh_token?: string };
    const accessToken = payload.access_token ?? payload.token;
    if (!accessToken || !payload.refresh_token) {
      return {
        ok: false,
        code: "AUTH_REFRESH_INVALID_PAYLOAD"
      };
    }

    return {
      ok: true,
      accessToken,
      refreshToken: payload.refresh_token
    };
  } catch {
    return {
      ok: false,
      code: "AUTH_REFRESH_NETWORK_ERROR"
    };
  }
}

function clearAuthCookies(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  try {
    cookieStore.delete("synteq_token");
    cookieStore.delete("synteq_refresh_token");
  } catch {
    // Server component contexts can be read-only for cookie writes.
  }
}

function persistSessionCookies(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
  accessToken: string,
  refreshToken: string
) {
  cookieStore.set("synteq_token", accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 15
  });
  cookieStore.set("synteq_refresh_token", refreshToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });
}

export async function getToken() {
  const cookieStore = await cookies();
  return cookieStore.get("synteq_token")?.value;
}

export async function requireToken() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("synteq_token")?.value;

  if (accessToken && isTokenFresh(accessToken)) {
    return accessToken;
  }

  const refreshToken = cookieStore.get("synteq_refresh_token")?.value;
  if (!refreshToken) {
    clearAuthCookies(cookieStore);
    redirect("/login");
  }

  const refreshed = await refreshSession(refreshToken);
  if (!refreshed.ok) {
    clearAuthCookies(cookieStore);
    redirect("/login");
  }

  try {
    persistSessionCookies(cookieStore, refreshed.accessToken, refreshed.refreshToken);
  } catch {
    // Server component contexts can be read-only for cookie writes.
    // Middleware still refreshes and persists cookies for page navigation.
  }

  return refreshed.accessToken;
}
