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
- Two tabs — Members and Summary Report
- Period filtering — This Week / Month / Quarter / Year / Custom / Specific Month
- 8 metric views — Current (All/Primary/Secondary), New Joiners, Churned, Renewals, Eligible, Refunded
- Renewal Rate computed in-browser as Actual / Eligible
- Paginated table with Load More
- CSV export — single view or full report
- HubSpot deep links on every contact name

## Data Notes

- Churned tracking starts April 13, 2026. Pre-April revocations have no date stamp.
- HubSpot caps filter groups at 6 filters. All queries stay at 6 or fewer.
- **Members page** renewal and eligible counts reflect whatever period is selected in the period bar.
- **Summary Report** always uses full calendar periods (Jan 1–31, Q1, full year, etc.).
- If the Members page and Summary Report show different numbers for the same month, check that the Members page period selector is set to the full calendar month.

## Security Reminders

- Rotate DASHBOARD_PASSWORD periodically (every 90 days recommended)
- Rotate HUBSPOT_TOKEN if it may have been exposed
- Never commit .env.local to version control

---

## Filter Criteria

All filters are defined in `lib/filters.ts` and applied via the HubSpot CRM Search API.

### Summary Report Columns

| Column | Definition |
|---|---|
| **New Primary** | Members who joined in the period — not Secondary, not CT Team, not revoked |
| **New Secondary** | Members who joined in the period with the Secondary Member tag |
| **Total New Members** | New Primary + New Secondary |
| **Churned** | Members whose access was revoked during the period |
| **Refunded** | Members with the CC Refunded tag whose expiration falls in the period |
| **Actual Renewals** | Members whose `latest_renewal_date` falls in the period |
| **Eligible Renewals** | Primary members whose membership expiration falls in the period |
| **Renewal Rate** | Actual Renewals ÷ (Eligible + Actual Renewals) × 100 |

---

### Current Members (All)
- Has tag: `Mastermind Member`
- Does **not** have tag: `CT Team`
- Does **not** have tag: `UA Mastermind Membership Revoked`
- `community_access_revoked` is not true

### Current Primary Members
- Same as Current Members (All)
- Does **not** have tag: `Secondary Member`

### Current Secondary Members
- Has tag: `Mastermind Member`
- Has tag: `Secondary Member`
- Does **not** have tag: `CT Team`
- `community_access_revoked` is not true

---

### New Primary Joiners
- `date_joined` falls within the selected period
- Does **not** have tag: `CT Team`
- Does **not** have tag: `Secondary Member`
- `community_access_revoked` is not true

### New Secondary Joiners
- `date_joined` falls within the selected period
- Has tag: `Secondary Member`
- Does **not** have tag: `CT Team`
- `community_access_revoked` is not true

---

### Churned
- `community_access_revoked` is true
- `community_access_revoked_date` falls within the selected period

> **Data note:** The `community_access_revoked_date` field was first populated on April 13, 2026. Churn counts for periods before that date will be 0 or incomplete.

---

### Actual Renewals
- Has tag: `Mastermind Member`
- Does **not** have tag: `CT Team`
- `latest_renewal_date` falls within the selected period

No revoked check — a member who renewed during the period and later churned still counts as a renewal.

---

### Eligible Renewals

Defined differently depending on whether the period is in the past or present/future.

**Past periods** (expiration month has already passed):
- Has tag: `Mastermind Member`
- Does **not** have tag: `Secondary Member`
- Does **not** have tag: `Acquired post-CC`
- Does **not** have tag: `CT Team`
- `expiration_date` falls within the period
- No revoked check — members who expired and did not renew are now marked revoked; excluding them would make historical counts near-zero

**Current & future periods** (expiration month is this month or later):
- Has tag: `Mastermind Member`
- Does **not** have tag: `Secondary Member`
- Does **not** have tag: `Acquired post-CC`
- `community_access_revoked` is not true
- `expiration_date` falls within the period

> **Why two different filters?** HubSpot has a 6-filter cap per query group. For past months, the revoked check is swapped for the CT Team exclusion. For current/future months, the revoked check is kept to show only active members with upcoming expirations. CT Team is not explicitly excluded in the current/future query — a small overcount of ~97 CT Team members.

---

### Refunded
- Has tag: `CC Refunded`
- Has tag: `Mastermind Member`
- Does **not** have tag: `CT Team`
- `expiration_date` falls within the selected period

---

## Tags Reference

| Tag | Meaning |
|---|---|
| `Mastermind Member` | Active or former academy member |
| `Secondary Member` | Add-on seat under a primary member |
| `CT Team` | Internal Contrarian Thinking team — excluded from all member counts |
| `UA Mastermind Membership Revoked` | Legacy revocation tag |
| `Acquired post-CC` | Member acquired via a non-standard channel; excluded from eligible renewals |
| `CC Refunded` | Member received a refund |
| `CC Renewal 2026` | Curated list of members targeted for 2026 renewal outreach |
