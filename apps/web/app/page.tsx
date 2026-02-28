import { redirect } from "next/navigation";
import { getToken } from "../lib/auth";

export default async function HomePage() {
  const token = await getToken();
  if (!token) {
    redirect("/login");
  }

  redirect("/overview");
}
