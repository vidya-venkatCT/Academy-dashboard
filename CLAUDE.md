@AGENTS.md

# Contrarian Academy Members Dashboard — Project Context

> **Read this file at the start of every session.** It is the single source of truth for architecture decisions, filter logic, known pitfalls, and hard-won fixes.

---

## Project Overview

A Next.js dashboard for Contrarian Academy (Contrarian Thinking) that pulls live membership data from HubSpot's CRM Search API. Displays membership metrics with calendar-period filtering and CSV exports.

- **Location:** `/Users/vidyavenkat/Contrarian Thinking /academy-dashboard/`
- **Framework:** Next.js 16.2.5 (App Router)
- **Auth:** Shared password → HMAC-SHA256 signed HTTP-only cookie, 30-day session
- **Data source:** HubSpot CRM Search API v3 — `POST /crm/v3/objects/contacts/search`

---

## Running the App

```bash
cd "/Users/vidyavenkat/Contrarian Thinking /academy-dashboard"
npm run dev
```

- **Login:** shared password stored in `DASHBOARD_PASSWORD` env var (`.env`)
- **HubSpot token:** stored in `HUBSPOT_TOKEN` env var (`.env`)
- **Dev server launcher:** `.claude/launch.json` with `autoPort: false` — port 3000 is reserved. Use `preview_start` tool (not raw `npm run dev`) to start the server.

---

## Architecture

```
app/
  page.tsx                  # Main dashboard (all UI, state, loaders)
  api/
    hubspot-search/
      route.ts              # Server-side HubSpot proxy (validates + forwards)
    auth/
      login/route.ts        # POST /api/auth/login — sets signed cookie
      logout/route.ts       # POST /api/auth/logout — clears cookie
    samcart/
      route.ts              # SamCart proxy (kept on disk, not used by UI)
    samcart-match/
      route.ts              # SamCart email-match endpoint (kept on disk, not used by UI)
lib/
  filters.ts                # ALL HubSpot filter definitions (single source of truth)
proxy.ts                    # Auth guard (Next.js 16 convention, replaces middleware.ts)
```

### Key architectural notes

- **`proxy.ts` not `middleware.ts`** — Next.js 16 uses `proxy.ts` with an exported `proxy` function (not `middleware`). Runs on Node.js runtime (not Edge), which allows using the `crypto` module for HMAC signing.
- **No Edge Runtime** — HMAC cookie signing requires Node.js `crypto`. Do not add `export const runtime = "edge"` anywhere.
- **`app/api/hubspot-search/route.ts`** is the only file that holds the HubSpot API token. The client never sees the token.
- **Counts use HubSpot `total`** — `searchContacts()` returns HubSpot's `total` field (full count, not just first page). All metric counts use `result.total`, not `result.results.length`.
- **`searchContacts()` accepts single or multi-group filters** — pass `HubSpotFilter[]` for a single filter group, or `HubSpotFilter[][]` for multiple groups (OR logic between groups). HubSpot deduplicates contacts across groups automatically.

---

## HubSpot API — Critical Rules

### Date property formats
- **`date`-type properties** (e.g. `expiration_date`, `date_joined`, `latest_renewal_date`) require **epoch milliseconds** as filter values — NOT `YYYY-MM-DD` strings. Use the `toEpochMs()` helper in `lib/filters.ts`.
- **`datetime`-type properties** (e.g. `community_access_revoked_date`) use ISO strings: `"2025-01-01T00:00:00Z"`.

### 6-filter cap per filter group
HubSpot silently returns 0 results (no error) if a single filter group exceeds 6 filters. **Never put more than 6 filters in one group.**

### Multiple filter groups = OR logic
Pass `HubSpotFilter[][]` to `searchContacts()` to use multiple filter groups. Groups are OR'd — a contact matching any group is returned. HubSpot deduplicates automatically. Each group still has its own 6-filter cap.

### Retry on 429
`route.ts` retries up to 3× with exponential backoff on HTTP 429. Client-side `searchContacts()` in `page.tsx` also has retry logic.

---

## Filter Definitions (`lib/filters.ts`)

### Snapshot views (no date period)

| Function | Purpose | Key filters |
|---|---|---|
| `currentAllFilters()` | All current members | Has `Mastermind Member`, not `CT Team`, not `UA Mastermind Membership Revoked`, `community_access_revoked NEQ true` |
| `currentSecondaryFilters()` | Current secondary members | Has `Mastermind Member` + `Secondary Member`, not `CT Team`, not revoked |
| `primaryBaseFilters()` | Base for primary-only queries | Has `Mastermind Member`, not `Secondary Member`, not `CT Team`, not revoked |

### Period views (take `start: string, end: string` as `"YYYY-MM-DD"`)

| Function | Returns | Purpose | Key filters |
|---|---|---|---|
| `newJoinersFilters(start, end)` | `HubSpotFilter[]` | All new joiners | `date_joined` in period, not `CT Team`, not revoked |
| `newJoinersPrimaryFilters(start, end)` | `HubSpotFilter[]` | New primary joiners | Same + not `Secondary Member` |
| `newJoinersSecondaryFilters(start, end)` | `HubSpotFilter[]` | New secondary joiners | Has `Secondary Member`, not `CT Team`, not revoked |
| `churnedFilters(start, end)` | `HubSpotFilter[]` | Churned members | `community_access_revoked EQ true`, `community_access_revoked_date` in period |
| `renewalActualFilters(start, end)` | `HubSpotFilter[]` | Actual renewals — contact list only | Has `Mastermind Member`, not `CT Team`, `latest_renewal_date` in period |
| `renewalActualMultiFilters(start, end)` | `HubSpotFilter[][]` | Actual renewals — counts (OR query) | Group 1: `latest_renewal_date` in period. Group 2: `CC Renewal 2026` tag + `date_joined` one year prior |
| `eligibleRenewalFilters(start, end)` | `HubSpotFilter[]` | Eligible renewals — **past periods** | Has `Mastermind Member`, not `Secondary Member`, not `Acquired post-CC`, not `CT Team`, `expiration_date` in period — no revoked check |
| `eligibleRenewalActiveFilters(start, end)` | `HubSpotFilter[]` | Eligible renewals — **current & future periods** | Has `Mastermind Member`, not `Secondary Member`, not `Acquired post-CC`, `community_access_revoked NEQ true`, `expiration_date` in period — no CT Team exclusion |
| `refundedFilters(start, end)` | `HubSpotFilter[]` | Refunded members | Has `CC Refunded` + `Mastermind Member`, not `CT Team`, `expiration_date` in period |

### Eligible Renewals — two-function design (past vs. current/future)

The 6-filter cap makes it impossible to include all desired conditions in one query. Two functions are used, selected based on whether `end < today`:

**`eligibleRenewalFilters` — for past periods (`end < today`)**
- No `community_access_revoked` check — members who expired in past months and didn't renew are now revoked; excluding them would make historical counts near-zero
- Excludes `CT Team` in place of the revoked check (fits in 6 filters)
- Excludes `Secondary Member` and `Acquired post-CC`

**`eligibleRenewalActiveFilters` — for current & future periods (`end >= today`)**
- Includes `community_access_revoked NEQ true` — shows only active members with an upcoming expiration
- Does NOT exclude `CT Team` (dropped to fit revoked check in 6-filter cap — ~97 CT Team members are a small acceptable overcount)
- Excludes `Secondary Member` and `Acquired post-CC`

### Actual Renewals — single-group design

`renewalActualFilters` is used for all counts (StatCard, Summary Report, and contact list):
- `Mastermind Member` + not `CT Team` + `latest_renewal_date` in period
- Intentionally excludes the revoked check — someone who renewed in the period and later churned still counts as a renewal

Note: `renewalActualMultiFilters` (OR query that also included CC Renewal 2026 tag) exists in `filters.ts` but is **not used** — it was found to inflate counts since CC Renewal 2026 contacts already have `latest_renewal_date` set and are counted by the single-group query.

---

## Dashboard Tabs

### Tab 1 — Members (default on load)
- **Snapshot metrics** (all-time, no period filter): Current Members (All), Current Primary, Current Secondary — **clickable**, shows contact list below when selected
- **Default active view on load:** New Joiners (not Primary) — avoids loading the full member list on page open
- **Period metrics** (respect selected period): New Joiners (with primary/secondary breakdown), Churned, Renewals Actual, Refunded, Eligible Renewals, Renewal Rate
- **Renewal Rate** = Actual Renewals / Eligible Renewals × 100, shown as `XX.X%` on the StatCard
- Contact list table below StatCards — shows for all active views (snapshot and period)
- CSV export of the individual contacts for the selected metric

### Tab 2 — Summary Report
- **Membership Snapshot** at the top (all-time): Current Members, Primary, Secondary (non-clickable StatCards)
- **Period breakdown table**: Monthly / Quarterly / Yearly selector + year selector
- **Columns**: Period | New Primary | New Secondary | Total New Members | Churned | Refunded | Actual Renewals | Eligible Renewals | Renewal Rate
- 6 metrics fetched in parallel per period via `Promise.allSettled`
- Totals row at the bottom (monthly and quarterly views only)
- CSV export of the table (`academy_summary_report_...csv`)
- Counts sourced from HubSpot `total` field (not paginated email count)
- Eligible Renewals uses `eligibleRenewalFilters` (past) or `eligibleRenewalActiveFilters` (current/future) per period
- Actual Renewals uses `renewalActualFilters` (single group, `latest_renewal_date` in period)

### Tab 3 — Methodology
- Displays all filter criteria in plain-English tables directly in the dashboard
- **Summary Report Columns** table — column name + definition
- **Per-metric filter cards** — conditions for New Primary/Secondary, Churned, Actual Renewals, Refunded
- **Eligible Renewals** — side-by-side Past vs Current/Future filter comparison with explanatory note
- **Tags Reference** — all HubSpot tags used and their meaning

### Removed features
- The former "Eligible Renewals" tab (`upcoming`) was removed. Eligible renewal contacts are accessible via the Eligible Renewals StatCard on the Members tab.
- SamCart integration removed from UI (routes kept on disk).
- CC Eligible (2026) column removed from Summary Report.

---

## Known Pitfalls & Fixes

| Symptom | Root cause | Fix |
|---|---|---|
| Renewals showing 13 instead of ~318 | `community_access_revoked NEQ true` excluded members who renewed but later churned | Removed that filter from `renewalActualFilters` |
| Eligible count too high | Secondary members and Acquired post-CC members included | Added `NOT_CONTAINS_TOKEN` for both |
| Past months eligible count near-zero | `community_access_revoked NEQ true` excluded expired non-renewers (who are now revoked) | Two filter functions: `eligibleRenewalFilters` (no revoked check) for past, `eligibleRenewalActiveFilters` (revoked check) for current/future |
| HubSpot returns 0 silently | Filter group exceeds 6 filters | Keep each filter group ≤ 6 filters |
| `400 Bad Request` from HubSpot | Date properties given `YYYY-MM-DD` strings instead of epoch ms | Use `toEpochMs()` for all `date`-type properties |
| `middleware.ts` auth not running | Next.js 16 deprecated `middleware.ts` convention | Renamed to `proxy.ts`, export `proxy` not `middleware` |
| `crypto` not available | Auth ran on Edge Runtime | `proxy.ts` runs Node.js runtime; do not use Edge Runtime |
| Port 3000 conflict on preview_start | Another process held port 3000 | `autoPort: false` set in `.claude/launch.json`; kill stale process then use `preview_start` |
| Churned data missing before Apr 13 2026 | `community_access_revoked_date` field was first stamped Apr 13, 2026 | Data note shown in UI; churned counts for earlier periods will be 0 or incomplete |

---

## Contact Properties Fetched

Defined in `lib/filters.ts` as `CONTACT_PROPERTIES`:

```
firstname, lastname, email, all_contact_tags,
community_access_revoked, community_access_revoked_date,
date_joined, latest_renewal_date, expiration_date, lastmodifieddate
```

---

## Environment Variables (`.env`)

```
HUBSPOT_TOKEN=<HubSpot private app token>
DASHBOARD_PASSWORD=<shared login password>
COOKIE_SECRET=<random 32+ char secret for HMAC signing>
NEXT_PUBLIC_HUBSPOT_PORTAL_ID=23982969
SAMCART_API_KEY=<present in .env but not actively used by the UI>
```

---

## Caching

- 30-second in-memory cache in `page.tsx`, keyed by filter signature (JSON-stringified filter groups)
- Server route sets `Cache-Control: s-maxage=5, stale-while-revalidate=5`

---

## HubSpot List Alignment Reference

When verifying counts against HubSpot saved lists, check that filter intent matches:
- `eligibleRenewalFilters` (past periods) excludes Secondary Members, Acquired post-CC, and CT Team — but includes revoked members
- `eligibleRenewalActiveFilters` (current/future) excludes Secondary Members, Acquired post-CC, and revoked — but includes CT Team (~97 members, small overcount)
- `renewalActualMultiFilters` includes CC Renewal 2026 contacts (matched to period via `date_joined` one year prior) in addition to `latest_renewal_date` matches

---

## Metric Logic Reference

> Plain-English definitions for each metric displayed in the dashboard.

### Current Members (All)
Members who currently have active access. Must have the `Mastermind Member` tag, must not have the `CT Team` or `UA Mastermind Membership Revoked` tags, and `community_access_revoked` must not be `true`.

### Current Primary Members
Same as Current Members (All), but additionally excludes anyone with the `Secondary Member` tag.

### Current Secondary Members
Members who have both `Mastermind Member` and `Secondary Member` tags, not `CT Team`, not revoked.

---

### New Joiners (Primary / Secondary)
Members whose `date_joined` field falls within the selected period, not `CT Team`, not revoked. Split into:
- **New Primary** — additionally excludes `Secondary Member`
- **New Secondary** — requires `Secondary Member` tag

---

### Churned
Members where `community_access_revoked = true` and `community_access_revoked_date` falls within the selected period.
> **Data note:** `community_access_revoked_date` was first populated on April 13, 2026. Churn counts for periods before that date will be 0 or incomplete.

---

### Actual Renewals
Members whose `latest_renewal_date` falls within the selected period **OR** who are tagged `CC Renewal 2026` and whose `date_joined` falls in the same calendar period one year prior.

- `Mastermind Member` required; `CT Team` excluded
- **No revoked check** — a member who renewed in the period and later churned still counts as a renewal
- Uses a two-group OR HubSpot query (`renewalActualMultiFilters`) for counts
- Contact list display uses the single-group `renewalActualFilters` (`latest_renewal_date` only)

---

### Eligible Renewals
Primary members whose `expiration_date` falls within the selected period. Excludes `Secondary Member`, `Acquired post-CC`.

**Two different filter functions are used depending on whether the period is in the past or future:**

| Period | Function | Revoked check | CT Team excluded |
|---|---|---|---|
| Past (`end < today`) | `eligibleRenewalFilters` | No — expired non-renewers are now revoked and must be included | Yes |
| Current / Future (`end >= today`) | `eligibleRenewalActiveFilters` | Yes — shows only active members with upcoming expiration | No (dropped to fit revoked check in 6-filter cap) |

**Why two functions?** HubSpot's 6-filter cap prevents including all desired conditions in a single query. For past months, the revoked check would exclude most eligible members (they expired and were revoked when they didn't renew), making the count near-zero. For current/future months, the revoked check is important to show only active members.

---

### Renewal Rate
`Actual Renewals ÷ Eligible Renewals × 100`, displayed as `XX.X%`. Calculated client-side from the two counts above.

---

### Refunded
Members with both `CC Refunded` and `Mastermind Member` tags, not `CT Team`, whose `expiration_date` falls within the selected period.
