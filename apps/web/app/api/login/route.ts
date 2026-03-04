import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { apiBaseUrl } from "../../../lib/config";

export async function POST(request: Request) {
  const body = (await request.json()) as { email?: string; password?: string };

  const response = await fetch(`${apiBaseUrl}/v1/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    return NextResponse.json({ error: text || "Invalid credentials" }, { status: 401 });
  }

  const payload = (await response.json()) as { token?: string; access_token?: string; refresh_token?: string };
  const accessToken = payload.access_token ?? payload.token;
  if (!accessToken || !payload.refresh_token) {
    return NextResponse.json({ error: "Invalid auth response" }, { status: 500 });
  }

  const cookieStore = await cookies();
  cookieStore.set("synteq_token", accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 15
  });
  cookieStore.set("synteq_refresh_token", payload.refresh_token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });

  return NextResponse.json({ ok: true });
}
