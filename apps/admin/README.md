# Velocity — Admin Panel (Web)

> **Placeholder — scaffolded in Stage 5** (see [`../../docs/ROADMAP.md`](../../docs/ROADMAP.md)).

A single web admin panel, gated to the `admin` role, for operations staff:

- Driver approvals (calls `approveDriver` / `rejectDriver`)
- Live operations map and KPIs (reads `system/counters`, `trips`)
- Finance: revenue, commission, payouts, ledger
- Safety desk: live `safetyEvents`, resolve via `resolveSafetyEvent`

## Planned stack
- React + Vite + TypeScript
- Firebase Auth (admin-claim gated; non-admins are rejected)
- Firestore real-time subscriptions for live dashboards

The visual language can evolve from the existing dashboards in `legacy-demo/`,
which already prototype these screens.
