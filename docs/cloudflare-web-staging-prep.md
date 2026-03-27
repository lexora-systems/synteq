# Cloudflare Frontend Staging Prep (Web Only)

This document prepares **only** the Next.js frontend for a future Cloudflare-hosted runtime.

Out of scope:

- no API migration
- no DB/Redis/PubSub/scheduler migration
- no Cloud Run IAM changes
- no DNS cutover

Backend remains on Google Cloud Run.

## Deployment Target

Synteq web is a full-stack Next.js app (middleware + route handlers + server actions + dynamic routes), so plain static Pages export is not a fit.

Use a Cloudflare Workers-compatible Next.js runtime path for frontend hosting.

## Minimal Scaffolding Added

Web workspace dependencies:

- `@opennextjs/cloudflare` (pinned to `^1.13.1` for compatibility with current `next@15.1.5`)
- `wrangler` (pinned to `^4.49.1`)

Web workspace files:

- `apps/web/wrangler.toml`
- `apps/web/open-next.config.ts`

Web workspace scripts:

- `npm run build:cloudflare --workspace web`
- `npm run preview:cloudflare --workspace web`
- `npm run deploy:cloudflare:dry-run --workspace web`

These are preparation scripts only. `deploy:cloudflare:dry-run` does not publish.

Current OpenNext config intentionally uses dummy cache/tag/queue overrides to avoid speculative platform bindings during prep.
If stronger cache/queue behavior is required later, add concrete Cloudflare bindings as a separate rollout step.

## Canonical Web API Environment Model

Canonical variable:

- `SYNTEQ_WEB_API_BASE_URL`

Compatibility variables (keep aligned with the canonical value):

- `API_BASE_URL`
- `NEXT_PUBLIC_API_BASE_URL`

Current web runtime resolves in this order:

1. `SYNTEQ_WEB_API_BASE_URL`
2. `API_BASE_URL`
3. `NEXT_PUBLIC_API_BASE_URL`
4. `http://localhost:8080` (local fallback only)

### Recommended values

Staging:

- `SYNTEQ_WEB_API_BASE_URL=https://<staging-api-cloud-run-host>`
- `API_BASE_URL=https://<staging-api-cloud-run-host>`
- `NEXT_PUBLIC_API_BASE_URL=https://<staging-api-cloud-run-host>`

Production (later cutover phase):

- `SYNTEQ_WEB_API_BASE_URL=https://<prod-api-cloud-run-host>`
- `API_BASE_URL=https://<prod-api-cloud-run-host>`
- `NEXT_PUBLIC_API_BASE_URL=https://<prod-api-cloud-run-host>`

Run env validation before deployment:

```bash
npm run check:cloudflare-env --workspace web
```

Then run a no-cutover Cloudflare build validation:

```bash
npm run build:cloudflare --workspace web
```

## Backend Alignment Requirements (Cloud Run API)

Before frontend cutover, ensure API config points to the frontend host:

- `CORS_ORIGIN=https://<frontend-host>`
- `WEB_BASE_URL=https://<frontend-host>`

For future custom domain rollout:

- `CORS_ORIGIN=https://synteq.lexora.ltd`
- `WEB_BASE_URL=https://synteq.lexora.ltd`

## Staging-First Smoke Checklist

Run these checks on a staging frontend host before any production cutover:

1. `GET /` returns `200`.
2. Login via `/login` succeeds and sets auth cookies.
3. Signup via `/signup` still succeeds (public signup behavior unchanged).
4. Invite accept flow `/invite/:token` still issues session and redirects correctly.
5. Onboarding `/welcome` still works end-to-end.
6. Dashboard `/overview` renders authenticated data.
7. Incidents pages (`/incidents`, `/incidents/:id`) remain functional.
8. Settings pages (`/settings/profile`, `/settings/team`, `/settings/tenant`, `/settings/security`) remain functional.
9. Web API proxy routes still work:
   - `POST /api/login`
   - `POST /api/signup`
   - `POST /api/logout`
   - `POST /api/scan/run`
   - `POST /api/simulate/:scenario`

## Known Runtime Follow-Ups (Not Blocking Prep)

- `apps/web/lib/auth.ts` uses `Buffer.from(..., "base64url")` for JWT exp parsing.
- Middleware/route handlers mutate cookies and rely on server runtime behavior.

Validate Node compatibility support in the selected Cloudflare Next.js runtime path before production cutover.
