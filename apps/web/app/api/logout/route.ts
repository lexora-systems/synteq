import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { apiBaseUrl } from "../../../lib/config";

export async function POST() {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get("synteq_refresh_token")?.value;

  if (refreshToken) {
    await fetch(`${apiBaseUrl}/v1/auth/logout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: "no-store"
    }).catch(() => {
      // best effort logout
    });
  }

  cookieStore.delete("synteq_token");
  cookieStore.delete("synteq_refresh_token");
  return new NextResponse(null, {
    status: 303,
    headers: {
      Location: "/login"
    }
  });
}
