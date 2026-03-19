import { redirect } from "next/navigation";
import { getToken } from "../lib/auth";
import { resolveActivationState } from "../lib/activation";

export default async function HomePage() {
  const token = await getToken();
  if (!token) {
    redirect("/login");
  }

  try {
    const activation = await resolveActivationState(token);
    if (activation.metricsUnavailable) {
      redirect("/overview");
    }

    redirect(activation.activated ? "/overview" : "/welcome");
  } catch {
    redirect("/overview");
  }
}
