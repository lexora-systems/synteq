"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { WorkspaceSetupLoadingCard } from "../../components/workspace-setup-loading";

export default function LoginPage() {
  const router = useRouter();
  const [tenantId, setTenantId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          tenant_id: tenantId || undefined,
          email,
          password
        })
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: "Login failed" }));
        setError(body.error ?? "Login failed");
        setLoading(false);
        return;
      }

      router.push("/session-setup");
    } catch {
      setError("Login failed");
      setLoading(false);
    }
  }

  if (loading) {
    return <WorkspaceSetupLoadingCard />;
  }

  return (
    <main className="login-shell">
      <div className="login-card">
        <p className="eyebrow">Synteq by Lexora</p>
        <h1 className="login-title">Sign in to Synteq risk detection</h1>
        <p className="login-subtitle">Use workspace tenant ID for shared-email accounts.</p>
        <form className="login-form" onSubmit={onSubmit}>
          <label>
            Workspace Tenant ID
            <input
              type="text"
              value={tenantId}
              onChange={(event) => setTenantId(event.target.value)}
              placeholder="Optional unless your email exists in multiple tenants"
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              required
            />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </label>
          {error ? <p className="login-error">{error}</p> : null}
          <button type="submit" disabled={loading}>{loading ? "Signing in..." : "Sign In"}</button>
        </form>
      </div>
    </main>
  );
}
