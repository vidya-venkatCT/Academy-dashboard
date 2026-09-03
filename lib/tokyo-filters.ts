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
  | "refunded"
  | "acquired";

function toEpochMs(dateStr: string, endOfDay = false): string {
  const suffix = endOfDay ? "T23:59:59Z" : "T00:00:00Z";
  return String(new Date(`${dateStr}${suffix}`).getTime());
}

// ─── Snapshot views (no period) ──────────────────────────────────────────────

/** Current Members (All) — status Active OR grace */
export function currentAllFilters(): HubSpotFilter[][] {
  return [
    [{ propertyName: "membership_status", operator: "EQ", value: "Active" }],
    [{ propertyName: "membership_status", operator: "EQ", value: "grace" }],
  ];
}

/** Current Primary — Active + primary type */
export function primaryBaseFilters(): HubSpotFilter[] {
  return [
    { propertyName: "membership_status", operator: "EQ", value: "Active" },
    { propertyName: "membership_type",   operator: "EQ", value: "primary" },
  ];
}

/** Current Secondary — Active + spouse OR Active + business partner */
export function currentSecondaryFilters(): HubSpotFilter[][] {
  return [
    [
      { propertyName: "membership_status", operator: "EQ", value: "Active" },
      { propertyName: "membership_type",   operator: "EQ", value: "secondary - spouse" },
    ],
    [
      { propertyName: "membership_status", operator: "EQ", value: "Active" },
      { propertyName: "membership_type",   operator: "EQ", value: "secondary - business partner" },
    ],
  ];
}

// ─── Period views ─────────────────────────────────────────────────────────────

/** New Joiners — membership_create_date in period */
export function newJoinersFilters(start: string, end: string): HubSpotFilter[] {
  return [
    { propertyName: "membership_create_date", operator: "GTE", value: toEpochMs(start) },
    { propertyName: "membership_create_date", operator: "LTE", value: toEpochMs(end, true) },
  ];
}

/** New Primary Joiners — membership_create_date in period, primary type */
export function newJoinersPrimaryFilters(start: string, end: string): HubSpotFilter[] {
  return [
    { propertyName: "membership_type",        operator: "EQ",  value: "primary" },
    { propertyName: "membership_create_date", operator: "GTE", value: toEpochMs(start) },
    { propertyName: "membership_create_date", operator: "LTE", value: toEpochMs(end, true) },
  ];
}

/** New Secondary Joiners — membership_create_date in period, secondary type */
export function newJoinersSecondaryFilters(start: string, end: string): HubSpotFilter[][] {
  return [
    [
      { propertyName: "membership_type",        operator: "EQ",  value: "secondary - spouse" },
      { propertyName: "membership_create_date", operator: "GTE", value: toEpochMs(start) },
      { propertyName: "membership_create_date", operator: "LTE", value: toEpochMs(end, true) },
    ],
    [
      { propertyName: "membership_type",        operator: "EQ",  value: "secondary - business partner" },
      { propertyName: "membership_create_date", operator: "GTE", value: toEpochMs(start) },
      { propertyName: "membership_create_date", operator: "LTE", value: toEpochMs(end, true) },
    ],
  ];
}

/** Churned — Inactive (all membership types) */
export function churnedFilters(start: string, end: string): HubSpotFilter[] {
  // NOTE: Tokyo may not have a revocation-date property — this uses membership_create_date as fallback.
  // Update the date property name once the correct "inactive since" field is identified.
  return [
    { propertyName: "membership_status", operator: "EQ", value: "Inactive" },
  ];
}

/** Renewals Actual — actual_renewal_date in period */
export function renewalActualFilters(start: string, end: string): HubSpotFilter[] {
  return [
    { propertyName: "actual_renewal_date", operator: "GTE", value: toEpochMs(start) },
    { propertyName: "actual_renewal_date", operator: "LTE", value: toEpochMs(end, true) },
  ];
}

/** Renewals Actual multi-filters — same as single group for Tokyo (no CC Renewal 2026 equivalent). */
export function renewalActualMultiFilters(start: string, end: string): HubSpotFilter[][] {
  return [renewalActualFilters(start, end)];
}

/**
 * Eligible Renewals — PAST periods.
 * expected_renewal_date in period, Inactive members included (they were eligible but didn't renew).
 */
export function eligibleRenewalFilters(start: string, end: string): HubSpotFilter[] {
  return [
    { propertyName: "membership_type",       operator: "EQ",  value: "primary" },
    { propertyName: "expected_renewal_date", operator: "GTE", value: toEpochMs(start) },
    { propertyName: "expected_renewal_date", operator: "LTE", value: toEpochMs(end, true) },
  ];
}

/**
 * Eligible Renewals — CURRENT & FUTURE periods.
 * expected_renewal_date in period, Active/grace members only.
 */
export function eligibleRenewalActiveFilters(start: string, end: string): HubSpotFilter[][] {
  return [
    [
      { propertyName: "membership_status",     operator: "EQ",  value: "Active" },
      { propertyName: "membership_type",       operator: "EQ",  value: "primary" },
      { propertyName: "expected_renewal_date", operator: "GTE", value: toEpochMs(start) },
      { propertyName: "expected_renewal_date", operator: "LTE", value: toEpochMs(end, true) },
    ],
    [
      { propertyName: "membership_status",     operator: "EQ",  value: "grace" },
      { propertyName: "membership_type",       operator: "EQ",  value: "primary" },
      { propertyName: "expected_renewal_date", operator: "GTE", value: toEpochMs(start) },
      { propertyName: "expected_renewal_date", operator: "LTE", value: toEpochMs(end, true) },
    ],
  ];
}

/** Refunded — Inactive - refunded */
export function refundedFilters(start: string, end: string): HubSpotFilter[] {
  return [
    { propertyName: "membership_status",     operator: "EQ",  value: "Inactive - refunded" },
    { propertyName: "expected_renewal_date", operator: "GTE", value: toEpochMs(start) },
    { propertyName: "expected_renewal_date", operator: "LTE", value: toEpochMs(end, true) },
  ];
}

/** Has Acquired a Business — owner_circle = true */
export function acquiredBusinessFilters(): HubSpotFilter[][] {
  return [
    [
      { propertyName: "membership_status", operator: "EQ", value: "Active" },
      { propertyName: "owner_circle",      operator: "EQ", value: "true" },
    ],
    [
      { propertyName: "membership_status", operator: "EQ", value: "Active" },
      { propertyName: "owner_circle",      operator: "EQ", value: "Yes" },
    ],
  ];
}

// ─── Properties to fetch ─────────────────────────────────────────────────────

export const CONTACT_PROPERTIES = [
  "firstname",
  "lastname",
  "email",
  "membership_status",
  "membership_type",
  "membership_create_date",
  "actual_renewal_date",
  "expected_renewal_date",
  "lastmodifieddate",
  "community_renewal_price",
  "owner_circle",
];
