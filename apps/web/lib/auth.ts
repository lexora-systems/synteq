import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function getToken() {
  const cookieStore = await cookies();
  return cookieStore.get("synteq_token")?.value;
}

export async function requireToken() {
  const token = await getToken();
  if (!token) {
    redirect("/login");
  }
  return token;
}
