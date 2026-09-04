export interface HubSpotFilter {
  propertyName: string;
  operator: string;
  value: string;
}

export type ViewKey =
  // ── Snapshot (all-time) ─────────────────────────────────────────────────────
  | "lifetime"
  | "current"
  | "primary"
  | "spouse"
  | "partner"
  | "acquired"
  | "churnedAll"
  | "renewalAll"
  | "refundedAll"
  | "cancellationsAll"
  // ── Period ──────────────────────────────────────────────────────────────────
  | "new"
  | "churned"
  | "renewal"
  | "eligible"
  | "refunded"
  | "cancellations";

function toEpochMs(dateStr: string, endOfDay = false): string {
  const suffix = endOfDay ? "T23:59:59Z" : "T00:00:00Z";
  return String(new Date(`${dateStr}${suffix}`).getTime());
}

const ACTIVE:  HubSpotFilter = { propertyName: "status", operator: "EQ", value: "Active" };
const GRACE:   HubSpotFilter = { propertyName: "status", operator: "EQ", value: "Grace" };
const PRIMARY: HubSpotFilter = { propertyName: "membership_type", operator: "EQ", value: "Primary" };
const SPOUSE:  HubSpotFilter = { propertyName: "membership_type", operator: "EQ", value: "Secondary - Spouse" };
const PARTNER: HubSpotFilter = { propertyName: "membership_type", operator: "EQ", value: "Secondary - Business Partner" };

/** Add NOT_CONTAINS_TOKEN exclusions for CT team domains to every filter group (within the 6-filter cap). */
export function withExcludeCT(groups: HubSpotFilter[][]): HubSpotFilter[][] {
  const domains = ["contrarianthink", "bizscout"];
  return groups.map((group) => {
    let g = [...group];
    for (const domain of domains) {
      if (g.length < 6) {
        g = [...g, { propertyName: "bdrm_login_email", operator: "NOT_CONTAINS_TOKEN", value: domain }];
      }
    }
    return g;
  });
}

/** Prepend a type = <value> filter to every filter group (or single-group array). */
export function withType(
  filters: HubSpotFilter[][] | HubSpotFilter[],
  type: string,
): HubSpotFilter[][] {
  const typeF: HubSpotFilter = { propertyName: "type", operator: "EQ", value: type };
  if (filters.length === 0) return [[typeF]];
  if (Array.isArray(filters[0])) {
    return (filters as HubSpotFilter[][]).map((g) => [typeF, ...g]);
  }
  return [[typeF, ...(filters as HubSpotFilter[])]];
}

// ─── Snapshot (all-time) filters ─────────────────────────────────────────────

/** All memberships ever — all 5 status values cover every record */
export function lifetimeFilters(): HubSpotFilter[][] {
  return [
    [{ propertyName: "status", operator: "EQ", value: "Active" }],
    [{ propertyName: "status", operator: "EQ", value: "Grace" }],
    [{ propertyName: "status", operator: "EQ", value: "Expired" }],
    [{ propertyName: "status", operator: "EQ", value: "Inactive – Delinquent" }],
    [{ propertyName: "status", operator: "EQ", value: "Inactive – Refunded" }],
  ];
}

/** Current Members — Active OR Grace */
export function currentAllFilters(): HubSpotFilter[][] {
  return [[ACTIVE], [GRACE]];
}

/** Current Primary — Active/Grace + Primary */
export function primaryBaseFilters(): HubSpotFilter[][] {
  return [[ACTIVE, PRIMARY], [GRACE, PRIMARY]];
}

/** Current Spouse — Active/Grace + Secondary - Spouse */
export function spouseFilters(): HubSpotFilter[][] {
  return [[ACTIVE, SPOUSE], [GRACE, SPOUSE]];
}

/** Current Business Partner — Active/Grace + Secondary - Business Partner */
export function partnerFilters(): HubSpotFilter[][] {
  return [[ACTIVE, PARTNER], [GRACE, PARTNER]];
}

/** Business Acquisitions — owners_circle = true + Active/Grace */
export function acquiredBusinessFilters(): HubSpotFilter[][] {
  return [
    [ACTIVE, { propertyName: "owners_circle", operator: "EQ", value: "true" }],
    [GRACE,  { propertyName: "owners_circle", operator: "EQ", value: "true" }],
  ];
}

/** Churned all-time — all 3 inactive statuses, no date filter */
export function churnedAllTimeFilters(): HubSpotFilter[][] {
  return [
    [{ propertyName: "status", operator: "EQ", value: "Expired" }],
    [{ propertyName: "status", operator: "EQ", value: "Inactive – Delinquent" }],
    [{ propertyName: "status", operator: "EQ", value: "Inactive – Refunded" }],
  ];
}

/** Actual Renewals all-time — any record with actual_renewal_date set */
export function renewalAllTimeFilters(): HubSpotFilter[] {
  return [{ propertyName: "actual_renewal_date", operator: "GTE", value: "0" }];
}

/** Refunded all-time — Inactive – Refunded, no date filter */
export function refundedAllTimeFilters(): HubSpotFilter[] {
  return [{ propertyName: "status", operator: "EQ", value: "Inactive – Refunded" }];
}

/** Cancellations all-time — access_revoked = true */
export function cancellationsAllTimeFilters(): HubSpotFilter[] {
  return [{ propertyName: "access_revoked", operator: "EQ", value: "true" }];
}

// ─── Period filters ───────────────────────────────────────────────────────────

/** New Joiners — Active/Grace + start_date_v2 in period */
export function newJoinersFilters(start: string, end: string): HubSpotFilter[][] {
  const gteF: HubSpotFilter = { propertyName: "start_date_v2", operator: "GTE", value: toEpochMs(start) };
  const lteF: HubSpotFilter = { propertyName: "start_date_v2", operator: "LTE", value: toEpochMs(end, true) };
  return [[ACTIVE, gteF, lteF], [GRACE, gteF, lteF]];
}

/** New Primary Joiners */
export function newJoinersPrimaryFilters(start: string, end: string): HubSpotFilter[][] {
  const gteF: HubSpotFilter = { propertyName: "start_date_v2", operator: "GTE", value: toEpochMs(start) };
  const lteF: HubSpotFilter = { propertyName: "start_date_v2", operator: "LTE", value: toEpochMs(end, true) };
  return [[ACTIVE, PRIMARY, gteF, lteF], [GRACE, PRIMARY, gteF, lteF]];
}

/** New Spouse Joiners */
export function newJoinersSpouseFilters(start: string, end: string): HubSpotFilter[][] {
  const gteF: HubSpotFilter = { propertyName: "start_date_v2", operator: "GTE", value: toEpochMs(start) };
  const lteF: HubSpotFilter = { propertyName: "start_date_v2", operator: "LTE", value: toEpochMs(end, true) };
  return [[ACTIVE, SPOUSE, gteF, lteF], [GRACE, SPOUSE, gteF, lteF]];
}

/** New Business Partner Joiners */
export function newJoinersPartnerFilters(start: string, end: string): HubSpotFilter[][] {
  const gteF: HubSpotFilter = { propertyName: "start_date_v2", operator: "GTE", value: toEpochMs(start) };
  const lteF: HubSpotFilter = { propertyName: "start_date_v2", operator: "LTE", value: toEpochMs(end, true) };
  return [[ACTIVE, PARTNER, gteF, lteF], [GRACE, PARTNER, gteF, lteF]];
}

/** Churned in period — all 3 inactive statuses + membership_inactive_date in period */
export function churnedFilters(start: string, end: string): HubSpotFilter[][] {
  const gteF: HubSpotFilter = { propertyName: "membership_inactive_date", operator: "GTE", value: toEpochMs(start) };
  const lteF: HubSpotFilter = { propertyName: "membership_inactive_date", operator: "LTE", value: toEpochMs(end, true) };
  return [
    [{ propertyName: "status", operator: "EQ", value: "Expired" },               gteF, lteF],
    [{ propertyName: "status", operator: "EQ", value: "Inactive – Delinquent" }, gteF, lteF],
    [{ propertyName: "status", operator: "EQ", value: "Inactive – Refunded" },   gteF, lteF],
  ];
}

/** Actual Renewals in period */
export function renewalActualFilters(start: string, end: string): HubSpotFilter[] {
  return [
    { propertyName: "actual_renewal_date", operator: "GTE", value: toEpochMs(start) },
    { propertyName: "actual_renewal_date", operator: "LTE", value: toEpochMs(end, true) },
  ];
}

export function renewalActualMultiFilters(start: string, end: string): HubSpotFilter[][] {
  return [renewalActualFilters(start, end)];
}

/** Expected Renewals (past) — Primary + Business Partner, any status, expected_renewal_date in period */
export function eligibleRenewalFilters(start: string, end: string): HubSpotFilter[][] {
  const gteF: HubSpotFilter = { propertyName: "expected_renewal_date", operator: "GTE", value: toEpochMs(start) };
  const lteF: HubSpotFilter = { propertyName: "expected_renewal_date", operator: "LTE", value: toEpochMs(end, true) };
  return [
    [PRIMARY, gteF, lteF],
    [PARTNER, gteF, lteF],
  ];
}

/** Expected Renewals (current/future) — Active/Grace + Primary + Business Partner + expected_renewal_date in period */
export function eligibleRenewalActiveFilters(start: string, end: string): HubSpotFilter[][] {
  const gteF: HubSpotFilter = { propertyName: "expected_renewal_date", operator: "GTE", value: toEpochMs(start) };
  const lteF: HubSpotFilter = { propertyName: "expected_renewal_date", operator: "LTE", value: toEpochMs(end, true) };
  return [
    [ACTIVE, PRIMARY, gteF, lteF],
    [GRACE,  PRIMARY, gteF, lteF],
    [ACTIVE, PARTNER, gteF, lteF],
    [GRACE,  PARTNER, gteF, lteF],
  ];
}

/** Refunded in period — Inactive – Refunded + expected_renewal_date in period */
export function refundedFilters(start: string, end: string): HubSpotFilter[] {
  return [
    { propertyName: "status", operator: "EQ", value: "Inactive – Refunded" },
    { propertyName: "expected_renewal_date", operator: "GTE", value: toEpochMs(start) },
    { propertyName: "expected_renewal_date", operator: "LTE", value: toEpochMs(end, true) },
  ];
}

/** Cancellations in period — access_revoked = true + revocation_date in period */
export function cancellationsFilters(start: string, end: string): HubSpotFilter[] {
  return [
    { propertyName: "access_revoked", operator: "EQ", value: "true" },
    { propertyName: "revocation_date", operator: "GTE", value: toEpochMs(start) },
    { propertyName: "revocation_date", operator: "LTE", value: toEpochMs(end, true) },
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
  "membership_inactive_date",
  "access_revoked",
  "type",
];
