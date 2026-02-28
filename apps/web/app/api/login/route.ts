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

  const payload = (await response.json()) as { token: string };
  const cookieStore = await cookies();
  cookieStore.set("synteq_token", payload.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12
  });

  return NextResponse.json({ ok: true });
}
