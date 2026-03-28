import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { apiBaseUrl } from "../../../lib/config";

export async function POST(request: Request) {
  const body = (await request.json()) as { tenant_id?: string; email?: string; password?: string };
  let response: Response;

  try {
    response = await fetch(`${apiBaseUrl}/v1/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
  } catch {
    return NextResponse.json(
      {
        error: "API is unreachable. Start backend on http://localhost:8080 or set API_BASE_URL.",
        code: "AUTH_API_UNREACHABLE"
      },
      { status: 503 }
    );
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
    return NextResponse.json(
      {
        error: payload.error ?? "Invalid credentials",
        code: payload.code
      },
      { status: response.status }
    );
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
