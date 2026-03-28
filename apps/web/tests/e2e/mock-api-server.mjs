import http from "node:http";

const PORT = Number(process.env.MOCK_API_PORT ?? 4010);

const USERS = {
  "nonactivated@synteq.local": { password: "Password123!", persona: "nonactivated" },
  "activated@synteq.local": { password: "Password123!", persona: "activated" },
  "invitee@synteq.local": { password: "Password123!", persona: "nonactivated" }
};

function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function issueAccessToken(persona) {
  const header = encodeBase64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const payload = encodeBase64Url(
    JSON.stringify({
      sub: `user-${persona}`,
      persona,
      role: "owner",
      exp: Math.floor(Date.now() / 1000) + 60 * 60
    })
  );
  return `${header}.${payload}.signature`;
}

function issueRefreshToken(persona) {
  return `refresh-${persona}`;
}

function parseJsonBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        resolve({});
      }
    });
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function parseAuthPersona(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return null;
  }
  const token = header.slice("Bearer ".length);
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload.persona === "string" ? payload.persona : null;
  } catch {
    return null;
  }
}

function ensureAuth(req, res) {
  const persona = parseAuthPersona(req);
  if (!persona) {
    sendJson(res, 401, { error: "Unauthorized", code: "AUTH_REQUIRED" });
    return null;
  }
  return persona;
}

function tenantSettings() {
  return {
    settings: {
      tenant_id: "tenant-e2e",
      default_currency: "USD",
      current_plan: "free",
      effective_plan: "free",
      trial: {
        status: "none",
        available: true,
        active: false,
        consumed: false,
        started_at: null,
        ends_at: null,
        source: null,
        days_remaining: 0
      }
    }
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
  const { pathname } = url;

  if (req.method === "GET" && pathname === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && pathname === "/v1/auth/login") {
    const body = await parseJsonBody(req);
    const email = typeof body.email === "string" ? body.email.toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const user = USERS[email];

    if (!user || user.password !== password) {
      sendJson(res, 401, {
        error: "Invalid credentials",
        code: "AUTH_INVALID_CREDENTIALS"
      });
      return;
    }

    sendJson(res, 200, {
      access_token: issueAccessToken(user.persona),
      refresh_token: issueRefreshToken(user.persona)
    });
    return;
  }

  if (req.method === "POST" && pathname === "/v1/auth/refresh") {
    const body = await parseJsonBody(req);
    const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : "";
    const persona = refreshToken.startsWith("refresh-") ? refreshToken.slice("refresh-".length) : "";
    if (!persona) {
      sendJson(res, 401, { error: "Invalid refresh token", code: "AUTH_REFRESH_FAILED" });
      return;
    }
    sendJson(res, 200, {
      access_token: issueAccessToken(persona),
      refresh_token: issueRefreshToken(persona)
    });
    return;
  }

  if (req.method === "POST" && pathname.startsWith("/v1/team/invite/") && pathname.endsWith("/accept")) {
    const body = await parseJsonBody(req);
    if (!body.full_name || !body.password) {
      sendJson(res, 400, { error: "Missing fields" });
      return;
    }
    sendJson(res, 200, {
      access_token: issueAccessToken("nonactivated"),
      refresh_token: issueRefreshToken("nonactivated")
    });
    return;
  }

  if (req.method === "GET" && pathname === "/v1/workflows") {
    const persona = ensureAuth(req, res);
    if (!persona) {
      return;
    }
    if (persona === "activated") {
      sendJson(res, 200, {
        workflows: [
          {
            id: "wf_1",
            slug: "payments-daily",
            display_name: "Payments Daily",
            environment: "prod",
            system: "checkout-service"
          }
        ]
      });
      return;
    }
    sendJson(res, 200, { workflows: [] });
    return;
  }

  if (req.method === "GET" && pathname === "/v1/metrics/overview") {
    const persona = ensureAuth(req, res);
    if (!persona) {
      return;
    }
    const activated = persona === "activated";
    sendJson(res, 200, {
      summary: {
        count_total: activated ? 12 : 0,
        count_success: activated ? 11 : 0,
        count_failed: activated ? 1 : 0,
        p95_duration_ms: activated ? 950 : 0,
        retry_rate: activated ? 0.05 : 0,
        duplicate_rate: activated ? 0.01 : 0,
        avg_cost_usd: activated ? 0.13 : 0,
        sum_cost_usd: activated ? 1.56 : 0
      },
      series: activated
        ? [
            {
              bucket_ts: new Date().toISOString(),
              count_total: 12,
              count_success: 11,
              count_failed: 1,
              p95_duration_ms: 950,
              retry_rate: 0.05,
              duplicate_rate: 0.01,
              avg_cost_usd: 0.13
            }
          ]
        : [],
      windows: {
        "5m": { count_failed: activated ? 1 : 0 },
        "15m": { count_failed: activated ? 1 : 0 }
      },
      last_updated: new Date().toISOString()
    });
    return;
  }

  if (req.method === "GET" && pathname === "/v1/settings/tenant") {
    const persona = ensureAuth(req, res);
    if (!persona) {
      return;
    }
    sendJson(res, 200, tenantSettings());
    return;
  }

  if (req.method === "GET" && pathname === "/v1/auth/me") {
    const persona = ensureAuth(req, res);
    if (!persona) {
      return;
    }
    sendJson(res, 200, {
      user: {
        user_id: `user_${persona}`,
        email: `${persona}@synteq.local`,
        full_name: persona === "activated" ? "Activated Owner" : "New Owner",
        tenant_id: "tenant-e2e",
        role: "owner",
        email_verified_at: new Date().toISOString()
      }
    });
    return;
  }

  if (req.method === "GET" && pathname === "/v1/incidents") {
    const persona = ensureAuth(req, res);
    if (!persona) {
      return;
    }
    sendJson(res, 200, {
      incidents: [],
      pagination: { page: 1, page_size: 25, total: 0, has_next: false },
      last_updated: new Date().toISOString()
    });
    return;
  }

  if (req.method === "POST" && pathname === "/v1/auth/logout") {
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { error: "Not found", path: pathname });
});

server.listen(PORT, "127.0.0.1", () => {
  // Keep output minimal; Playwright only needs the process alive.
  console.log(`Mock API listening on http://127.0.0.1:${PORT}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
