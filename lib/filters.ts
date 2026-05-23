export interface HubSpotFilter {
  propertyName: string;
  operator: string;
  value: string;
}

export type ViewKey =
  | "current"
  | "primary"
  | "secondary"
  | "new"
  | "churned"
  | "renewal"
  | "eligible"
  | "refunded";

function toEpochMs(dateStr: string, endOfDay = false): string {
  const suffix = endOfDay ? "T23:59:59Z" : "T00:00:00Z";
  return String(new Date(`${dateStr}${suffix}`).getTime());
}

/** Shift a YYYY-MM-DD date back by one year */
function shiftYearBack(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

/** 4 filters — the base for all primary-member queries */
export function primaryBaseFilters(): HubSpotFilter[] {
  return [
    { propertyName: "all_contact_tags", operator: "CONTAINS_TOKEN",     value: "Mastermind Member" },
    { propertyName: "all_contact_tags", operator: "NOT_CONTAINS_TOKEN", value: "Secondary Member" },
    { propertyName: "all_contact_tags", operator: "NOT_CONTAINS_TOKEN", value: "CT Team" },
    { propertyName: "community_access_revoked", operator: "NEQ",        value: "true" },
  ];
}

// ─── Snapshot views (no period) ──────────────────────────────────────────────

/** Current Members (All) — not revoked, not CT Team, has Mastermind Member tag, not revoked via legacy tag */
export function currentAllFilters(): HubSpotFilter[] {
  return [
    { propertyName: "all_contact_tags", operator: "CONTAINS_TOKEN",     value: "Mastermind Member" },
    { propertyName: "all_contact_tags", operator: "NOT_CONTAINS_TOKEN", value: "CT Team" },
    { propertyName: "all_contact_tags", operator: "NOT_CONTAINS_TOKEN", value: "UA Mastermind Membership Revoked" },
    { propertyName: "community_access_revoked", operator: "NEQ",        value: "true" },
  ];
}

/** Current Secondary */
export function currentSecondaryFilters(): HubSpotFilter[] {
  return [
    { propertyName: "all_contact_tags", operator: "CONTAINS_TOKEN",     value: "Mastermind Member" },
    { propertyName: "all_contact_tags", operator: "CONTAINS_TOKEN",     value: "Secondary Member" },
    { propertyName: "all_contact_tags", operator: "NOT_CONTAINS_TOKEN", value: "CT Team" },
    { propertyName: "community_access_revoked", operator: "NEQ",        value: "true" },
  ];
}

// ─── Period views ─────────────────────────────────────────────────────────────

/** New Joiners Total — anyone with date_joined in period, not CT Team, not revoked */
export function newJoinersFilters(start: string, end: string): HubSpotFilter[] {
  return [
    { propertyName: "all_contact_tags", operator: "NOT_CONTAINS_TOKEN", value: "CT Team" },
    { propertyName: "community_access_revoked", operator: "NEQ",        value: "true" },
    { propertyName: "date_joined", operator: "GTE", value: toEpochMs(start) },
    { propertyName: "date_joined", operator: "LTE", value: toEpochMs(end, true) },
  ];
}

/** New Primary Joiners — date_joined in period, not CT Team, not Secondary Member, not revoked */
export function newJoinersPrimaryFilters(start: string, end: string): HubSpotFilter[] {
  return [
    { propertyName: "all_contact_tags", operator: "NOT_CONTAINS_TOKEN", value: "CT Team" },
    { propertyName: "all_contact_tags", operator: "NOT_CONTAINS_TOKEN", value: "Secondary Member" },
    { propertyName: "community_access_revoked", operator: "NEQ",        value: "true" },
    { propertyName: "date_joined", operator: "GTE", value: toEpochMs(start) },
    { propertyName: "date_joined", operator: "LTE", value: toEpochMs(end, true) },
  ];
}

/** New Secondary Joiners — date_joined in period, has Secondary Member tag, not CT Team, not revoked */
export function newJoinersSecondaryFilters(start: string, end: string): HubSpotFilter[] {
  return [
    { propertyName: "all_contact_tags", operator: "CONTAINS_TOKEN",     value: "Secondary Member" },
    { propertyName: "all_contact_tags", operator: "NOT_CONTAINS_TOKEN", value: "CT Team" },
    { propertyName: "community_access_revoked", operator: "NEQ",        value: "true" },
    { propertyName: "date_joined", operator: "GTE", value: toEpochMs(start) },
    { propertyName: "date_joined", operator: "LTE", value: toEpochMs(end, true) },
  ];
}

/** Churned — 3 filters (community_access_revoked_date available from Apr 13 2026) */
export function churnedFilters(start: string, end: string): HubSpotFilter[] {
  return [
    { propertyName: "community_access_revoked", operator: "EQ",  value: "true" },
    { propertyName: "community_access_revoked_date", operator: "GTE", value: `${start}T00:00:00Z` },
    { propertyName: "community_access_revoked_date", operator: "LTE", value: `${end}T23:59:59Z` },
  ];
}

/** Renewals Actual — single group for contact list display.
 *  Mastermind Member, not CT Team, latest_renewal_date in period. */
export function renewalActualFilters(start: string, end: string): HubSpotFilter[] {
  return [
    { propertyName: "all_contact_tags", operator: "CONTAINS_TOKEN",     value: "Mastermind Member" },
    { propertyName: "all_contact_tags", operator: "NOT_CONTAINS_TOKEN", value: "CT Team" },
    { propertyName: "latest_renewal_date", operator: "GTE", value: toEpochMs(start) },
    { propertyName: "latest_renewal_date", operator: "LTE", value: toEpochMs(end, true) },
  ];
}

/**
 * Renewals Actual — multi-group OR query for counts (StatCard + Summary Report).
 * Group 1: latest_renewal_date in period (standard renewal).
 * Group 2: tagged "CC Renewal 2026" AND date_joined one year prior to the period
 *          (i.e., a Jan-2025 joiner counts as a Jan-2026 renewal).
 * HubSpot deduplicates contacts matching both groups.
 */
export function renewalActualMultiFilters(start: string, end: string): HubSpotFilter[][] {
  return [
    [
      { propertyName: "all_contact_tags", operator: "CONTAINS_TOKEN",     value: "Mastermind Member" },
      { propertyName: "all_contact_tags", operator: "NOT_CONTAINS_TOKEN", value: "CT Team" },
      { propertyName: "latest_renewal_date", operator: "GTE", value: toEpochMs(start) },
      { propertyName: "latest_renewal_date", operator: "LTE", value: toEpochMs(end, true) },
    ],
    [
      { propertyName: "all_contact_tags", operator: "CONTAINS_TOKEN", value: "CC Renewal 2026" },
      { propertyName: "date_joined", operator: "GTE", value: toEpochMs(shiftYearBack(start)) },
      { propertyName: "date_joined", operator: "LTE", value: toEpochMs(shiftYearBack(end), true) },
    ],
  ];
}


/**
 * Eligible Renewals — PAST periods (end date before today).
 * No revoked check: captures everyone whose expiration fell in the period, including
 * members who have since churned (their access was revoked after they didn't renew).
 * CT Team excluded in place of the revoked check to stay within the 6-filter cap.
 */
export function eligibleRenewalFilters(start: string, end: string): HubSpotFilter[] {
  return [
    { propertyName: "all_contact_tags", operator: "CONTAINS_TOKEN",     value: "Mastermind Member" },
    { propertyName: "all_contact_tags", operator: "NOT_CONTAINS_TOKEN", value: "Secondary Member" },
    { propertyName: "all_contact_tags", operator: "NOT_CONTAINS_TOKEN", value: "Acquired post-CC" },
    { propertyName: "all_contact_tags", operator: "NOT_CONTAINS_TOKEN", value: "CT Team" },
    { propertyName: "expiration_date",  operator: "GTE", value: toEpochMs(start) },
    { propertyName: "expiration_date",  operator: "LTE", value: toEpochMs(end, true) },
  ];
}

/**
 * Eligible Renewals — CURRENT & FUTURE periods (end date on or after today).
 * Revoked check included: shows only active members with an upcoming expiration.
 * CT Team not explicitly excluded (dropped to fit revoked check in 6-filter cap —
 * small overcount of ~97 CT Team members across the year).
 */
export function eligibleRenewalActiveFilters(start: string, end: string): HubSpotFilter[] {
  return [
    { propertyName: "all_contact_tags", operator: "CONTAINS_TOKEN",     value: "Mastermind Member" },
    { propertyName: "all_contact_tags", operator: "NOT_CONTAINS_TOKEN", value: "Secondary Member" },
    { propertyName: "all_contact_tags", operator: "NOT_CONTAINS_TOKEN", value: "Acquired post-CC" },
    { propertyName: "community_access_revoked", operator: "NEQ",        value: "true" },
    { propertyName: "expiration_date",  operator: "GTE", value: toEpochMs(start) },
    { propertyName: "expiration_date",  operator: "LTE", value: toEpochMs(end, true) },
  ];
}

/** CC Renewal 2026 — contacts tagged "CC Renewal 2026" whose expiration falls in period.
 *  Used to compare the curated CC list against the system-computed eligible renewals. */
export function ccRenewal2026Filters(start: string, end: string): HubSpotFilter[] {
  return [
    { propertyName: "all_contact_tags", operator: "CONTAINS_TOKEN", value: "CC Renewal 2026" },
    { propertyName: "expiration_date",  operator: "GTE", value: toEpochMs(start) },
    { propertyName: "expiration_date",  operator: "LTE", value: toEpochMs(end, true) },
  ];
}

/** Refunded — 5 filters */
export function refundedFilters(start: string, end: string): HubSpotFilter[] {
  return [
    { propertyName: "all_contact_tags", operator: "CONTAINS_TOKEN",     value: "CC Refunded" },
    { propertyName: "all_contact_tags", operator: "CONTAINS_TOKEN",     value: "Mastermind Member" },
    { propertyName: "all_contact_tags", operator: "NOT_CONTAINS_TOKEN", value: "CT Team" },
    { propertyName: "expiration_date",  operator: "GTE", value: toEpochMs(start) },
    { propertyName: "expiration_date",  operator: "LTE", value: toEpochMs(end, true) },
  ];
}

// ─── Properties to fetch ─────────────────────────────────────────────────────

export const CONTACT_PROPERTIES = [
  "firstname",
  "lastname",
  "email",
  "all_contact_tags",
  "community_access_revoked",
  "community_access_revoked_date",
  "date_joined",
  "latest_renewal_date",
  "expiration_date",
  "lastmodifieddate",
];
