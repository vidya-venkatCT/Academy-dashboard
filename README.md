# Contrarian Academy Members Dashboard

A hosted, multi-user Next.js dashboard that pulls live data from HubSpot CRM, displaying Contrarian Academy membership metrics with calendar-period filtering and CSV exports.

## Setup

### 1. Clone and install

```bash
git clone <your-repo-url>
cd academy-dashboard
npm install
```

### 2. Configure environment variables

```bash
cp .env.local.example .env.local
```

| Variable | Description |
|---|---|
| `HUBSPOT_TOKEN` | HubSpot Private App token — [create one here](https://developers.hubspot.com/docs/api/private-apps) with scope `crm.objects.contacts.read` |
| `HUBSPOT_PORTAL_ID` | Your HubSpot portal ID (found in the URL when logged in) |
| `DASHBOARD_PASSWORD` | Shared password for team access |
| `SESSION_SECRET` | Random 32-char string — run `openssl rand -hex 16` |
| `NEXT_PUBLIC_HUBSPOT_PORTAL_ID` | Same as `HUBSPOT_PORTAL_ID` — exposed to browser for deep links |

### 3. Run locally

```bash
npm run dev
```

Visit http://localhost:3000 — you will be redirected to /login.

## Deploy to Vercel

1. Push this repo to GitHub.
2. Go to vercel.com → Add New Project → import the repo.
3. In Environment Variables, add all five variables from `.env.local.example`.
4. Click Deploy.
5. Optional: add a custom domain in Project Settings → Domains.

## Features

- Password-gated — shared team password, HTTP-only signed cookie, 30-day session
- Two tabs — Members and Eligible Renewals
- Period filtering — This Week / Month / Quarter / Year / Custom / Specific Month
- 8 metric views — Current (All/Primary/Secondary), New Joiners, Churned, Renewals, Eligible, Refunded
- Renewal Rate computed in-browser as Actual / Eligible
- Paginated table with Load More
- CSV export — single view or full 8-segment report
- HubSpot deep links on every contact name

## Data notes

- Churned tracking starts April 13, 2026. Pre-April revocations have no date stamp.
- HubSpot caps filter groups at 6 filters. All queries stay at 6 or fewer.

## Security reminders

- Rotate DASHBOARD_PASSWORD periodically (every 90 days recommended)
- Rotate HUBSPOT_TOKEN if it may have been exposed
- Never commit .env.local to version control
