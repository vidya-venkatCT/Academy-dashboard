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

// No type filter — portal 51278247 contains only Tokyo memberships
// (both "Boardroom" and "Academy" product types are used here)
const ACTIVE:  HubSpotFilter = { propertyName: "status", operator: "EQ", value: "Active" };
const GRACE:   HubSpotFilter = { propertyName: "status", operator: "EQ", value: "Grace" };
const PRIMARY: HubSpotFilter = { propertyName: "membership_type", operator: "EQ", value: "Primary" };
const SPOUSE:  HubSpotFilter = { propertyName: "membership_type", operator: "EQ", value: "Secondary - Spouse" };
const PARTNER: HubSpotFilter = { propertyName: "membership_type", operator: "EQ", value: "Secondary - Business Partner" };

// ─── Snapshot views ───────────────────────────────────────────────────────────

/** Current Members — status Active OR Grace */
export function currentAllFilters(): HubSpotFilter[][] {
  return [
    [ACTIVE],
    [GRACE],
  ];
}

/** Primary — Active/Grace + membership_type = Primary */
export function primaryBaseFilters(): HubSpotFilter[][] {
  return [
    [ACTIVE, PRIMARY],
    [GRACE,  PRIMARY],
  ];
}

/** Secondary — Active/Grace + Spouse OR Business Partner */
export function currentSecondaryFilters(): HubSpotFilter[][] {
  return [
    [ACTIVE, SPOUSE],
    [ACTIVE, PARTNER],
    [GRACE,  SPOUSE],
    [GRACE,  PARTNER],
  ];
}

// ─── Period views ─────────────────────────────────────────────────────────────

/** New Joiners — Active/Grace + start_date_v2 in period */
export function newJoinersFilters(start: string, end: string): HubSpotFilter[][] {
  const gteF: HubSpotFilter = { propertyName: "start_date_v2", operator: "GTE", value: toEpochMs(start) };
  const lteF: HubSpotFilter = { propertyName: "start_date_v2", operator: "LTE", value: toEpochMs(end, true) };
  return [
    [ACTIVE, gteF, lteF],
    [GRACE,  gteF, lteF],
  ];
}

/** New Primary Joiners */
export function newJoinersPrimaryFilters(start: string, end: string): HubSpotFilter[][] {
  const gteF: HubSpotFilter = { propertyName: "start_date_v2", operator: "GTE", value: toEpochMs(start) };
  const lteF: HubSpotFilter = { propertyName: "start_date_v2", operator: "LTE", value: toEpochMs(end, true) };
  return [
    [ACTIVE, PRIMARY, gteF, lteF],
    [GRACE,  PRIMARY, gteF, lteF],
  ];
}

/** New Secondary Joiners */
export function newJoinersSecondaryFilters(start: string, end: string): HubSpotFilter[][] {
  const gteF: HubSpotFilter = { propertyName: "start_date_v2", operator: "GTE", value: toEpochMs(start) };
  const lteF: HubSpotFilter = { propertyName: "start_date_v2", operator: "LTE", value: toEpochMs(end, true) };
  return [
    [ACTIVE, SPOUSE,  gteF, lteF],
    [ACTIVE, PARTNER, gteF, lteF],
    [GRACE,  SPOUSE,  gteF, lteF],
    [GRACE,  PARTNER, gteF, lteF],
  ];
}

/** Churned — Inactive (all 3 statuses: Expired, Delinquent, Refunded) */
export function churnedFilters(_start: string, _end: string): HubSpotFilter[][] {
  return [
    [{ propertyName: "status", operator: "EQ", value: "Expired" }],
    [{ propertyName: "status", operator: "EQ", value: "Inactive – Delinquent" }],
    [{ propertyName: "status", operator: "EQ", value: "Inactive – Refunded" }],
  ];
}

/** Actual Renewals — actual_renewal_date in period */
export function renewalActualFilters(start: string, end: string): HubSpotFilter[] {
  return [
    { propertyName: "actual_renewal_date", operator: "GTE", value: toEpochMs(start) },
    { propertyName: "actual_renewal_date", operator: "LTE", value: toEpochMs(end, true) },
  ];
}

export function renewalActualMultiFilters(start: string, end: string): HubSpotFilter[][] {
  return [renewalActualFilters(start, end)];
}

/** Eligible Renewals (past) — expected_renewal_date in period, Primary, any status */
export function eligibleRenewalFilters(start: string, end: string): HubSpotFilter[] {
  return [
    PRIMARY,
    { propertyName: "expected_renewal_date", operator: "GTE", value: toEpochMs(start) },
    { propertyName: "expected_renewal_date", operator: "LTE", value: toEpochMs(end, true) },
  ];
}

/** Eligible Renewals (current) — Active/Grace + Primary + expected_renewal_date in period */
export function eligibleRenewalActiveFilters(start: string, end: string): HubSpotFilter[][] {
  const gteF: HubSpotFilter = { propertyName: "expected_renewal_date", operator: "GTE", value: toEpochMs(start) };
  const lteF: HubSpotFilter = { propertyName: "expected_renewal_date", operator: "LTE", value: toEpochMs(end, true) };
  return [
    [ACTIVE, PRIMARY, gteF, lteF],
    [GRACE,  PRIMARY, gteF, lteF],
  ];
}

/** Refunded — status = Inactive – Refunded, in period by expected_renewal_date */
export function refundedFilters(start: string, end: string): HubSpotFilter[] {
  return [
    { propertyName: "status", operator: "EQ", value: "Inactive – Refunded" },
    { propertyName: "expected_renewal_date", operator: "GTE", value: toEpochMs(start) },
    { propertyName: "expected_renewal_date", operator: "LTE", value: toEpochMs(end, true) },
  ];
}

/** Has Acquired a Business — owners_circle = true + Active/Grace */
export function acquiredBusinessFilters(): HubSpotFilter[][] {
  return [
    [ACTIVE, { propertyName: "owners_circle", operator: "EQ", value: "true" }],
    [GRACE,  { propertyName: "owners_circle", operator: "EQ", value: "true" }],
  ];
}

// ─── Properties to fetch ─────────────────────────────────────────────────────

export const CONTACT_PROPERTIES = [
  "member_name",
  "bdrm_login_email",
  "status",
  "membership_type",
  "start_date_v2",
  "actual_renewal_date",
  "expected_renewal_date",
  "owners_circle",
  "renewal_price",
  "revocation_date",
  "type",
];
