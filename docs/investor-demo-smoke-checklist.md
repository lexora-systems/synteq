# Synteq Investor Demo Smoke Checklist

Use this checklist after deploying or after running the local demo seed.

## Demo Seed

Run the existing API seed command for the target demo database:

```powershell
npm.cmd run seed --workspace api
```

The seed creates the Synteq Demo tenant/admin, one active n8n-style workflow source, alert policies, recent operational events, one open demo incident, one resolved demo incident, and incident lifecycle events. Demo-created incidents and operational events are marked with `demo: true` metadata and use deterministic demo fingerprints/request IDs so reruns replace the demo walkthrough data.

## Navigation Smoke

1. Log in with the configured demo admin credentials.
2. Open `/welcome` and confirm activation state renders without the global error page.
3. Open `/overview` and confirm:
   - operational dashboard loads,
   - recent events are visible,
   - reliability windows show 1h, 24h, and 7d data,
   - investigation tools render.
4. Open `/sources` and confirm the connected n8n workflow source appears.
5. Open `/incidents` and confirm the open and resolved demo incidents are listed.
6. Open the open incident detail page and confirm timeline/lifecycle events render.
7. Open the workflow detail page from the incident detail view and confirm metrics route does not crash.
8. Confirm no route falls into `apps/web/app/error.tsx`.

## Founder Walkthrough

Start at `/sources` to show a connected source, then move to `/overview` to show recent operational risk, reliability windows, and dashboard state. Open `/incidents` to show the active failure-rate incident and attention grouping, then open the incident detail page to explain timeline context and recovery/resolution evidence. Use the resolved incident to show lifecycle closure.

## Do Not Claim Yet

Do not claim billing, compliance automation, broad third-party integration coverage, or fully autonomous AI remediation. Position the current build as an early reliability intelligence MVP with source ingestion, operational event modeling, incident visibility, timeline context, and dashboard/reliability-window foundations.
