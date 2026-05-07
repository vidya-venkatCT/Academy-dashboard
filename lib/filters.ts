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

/** New Joiners — 6 filters total */
export function newJoinersFilters(start: string, end: string): HubSpotFilter[] {
  return [
    ...primaryBaseFilters(), // 4
    { propertyName: "date_joined", operator: "GTE", value: start },
    { propertyName: "date_joined", operator: "LTE", value: end },
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

/** Renewals Actual — 6 filters total */
export function renewalActualFilters(start: string, end: string): HubSpotFilter[] {
  return [
    ...primaryBaseFilters(), // 4
    { propertyName: "latest_renewal_date", operator: "GTE", value: start },
    { propertyName: "latest_renewal_date", operator: "LTE", value: end },
  ];
}

/** Eligible Renewals — 6 filters total */
export function eligibleRenewalFilters(start: string, end: string): HubSpotFilter[] {
  return [
    ...primaryBaseFilters(), // 4
    { propertyName: "expiration_date", operator: "GTE", value: start },
    { propertyName: "expiration_date", operator: "LTE", value: end },
  ];
}

/** Refunded — 5 filters */
export function refundedFilters(start: string, end: string): HubSpotFilter[] {
  return [
    { propertyName: "all_contact_tags", operator: "CONTAINS_TOKEN",     value: "CC Refunded" },
    { propertyName: "all_contact_tags", operator: "CONTAINS_TOKEN",     value: "Mastermind Member" },
    { propertyName: "all_contact_tags", operator: "NOT_CONTAINS_TOKEN", value: "CT Team" },
    { propertyName: "expiration_date",  operator: "GTE", value: start },
    { propertyName: "expiration_date",  operator: "LTE", value: end },
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
