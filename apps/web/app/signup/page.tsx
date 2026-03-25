"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SignupPage() {
  const router = useRouter();
  const [workspaceName, setWorkspaceName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    const response = await fetch("/api/signup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        workspace_name: workspaceName,
        full_name: fullName,
        email,
        password
      })
    });
    setLoading(false);

    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: "Signup failed" }));
      setError(body.error ?? "Signup failed");
      return;
    }

    router.push("/welcome");
  }

  return (
    <main className="login-shell">
      <div className="login-card">
        <p className="eyebrow">Synteq by Lexora</p>
        <h1 className="login-title">Create your account</h1>
        <p className="login-subtitle">Set up your workspace, start trial onboarding, and invite your team later.</p>
        <form className="login-form" onSubmit={onSubmit}>
          <label>
            Workspace Name
            <input
              type="text"
              value={workspaceName}
              onChange={(event) => setWorkspaceName(event.target.value)}
              placeholder="Lexora Engineering"
              required
            />
          </label>
          <label>
            Full Name
            <input
              type="text"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="Alexis Marie"
              required
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
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 8 characters"
              minLength={8}
              required
            />
          </label>
          <label>
            Confirm Password
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Re-enter password"
              minLength={8}
              required
            />
          </label>
          {error ? <p className="login-error">{error}</p> : null}
          <button type="submit" disabled={loading}>{loading ? "Creating account..." : "Get Started"}</button>
        </form>
        <p className="mt-4 text-sm text-slate-600">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-ocean hover:text-ink">
            Log in
          </Link>
        </p>
      </div>
    </main>
  );
}
