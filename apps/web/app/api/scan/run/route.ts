import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { apiBaseUrl } from "../../../../lib/config";

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

async function refreshAccessToken(refreshToken: string) {
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

  const payload = (await response.json()) as {
    token?: string;
    access_token?: string;
    refresh_token?: string;
  };
  const accessToken = payload.access_token ?? payload.token;
  if (!accessToken || !payload.refresh_token) {
    return null;
  }

  return {
    accessToken,
    refreshToken: payload.refresh_token
  };
}

async function postScan(accessToken: string, body: unknown) {
  return fetch(`${apiBaseUrl}/v1/scan/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify(body),
    cache: "no-store"
  });
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("synteq_token")?.value;
  const refreshToken = cookieStore.get("synteq_refresh_token")?.value;
  const body = await request.json().catch(() => ({}));

  if (!accessToken && !refreshToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let response = accessToken ? await postScan(accessToken, body) : null;
  if (!response || response.status === 401) {
    if (!refreshToken) {
      cookieStore.delete("synteq_token");
      cookieStore.delete("synteq_refresh_token");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const refreshed = await refreshAccessToken(refreshToken);
    if (!refreshed) {
      cookieStore.delete("synteq_token");
      cookieStore.delete("synteq_refresh_token");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    persistSessionCookies(cookieStore, refreshed.accessToken, refreshed.refreshToken);
    response = await postScan(refreshed.accessToken, body);
  }

  const payload = (await response.json().catch(async () => ({ error: await response.text() }))) as Record<string, unknown>;
  return NextResponse.json(payload, { status: response.status });
}

