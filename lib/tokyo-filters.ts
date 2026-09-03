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

const ACTIVE: HubSpotFilter = { propertyName: "active_boardroom_member", operator: "EQ", value: "true" };

// Returns a filter that matches nothing (for views where no HubSpot property exists yet)
function impossibleFilter(): HubSpotFilter[] {
  return [{ propertyName: "temp_smb_boardroom_date_joined", operator: "GTE", value: "9999999999999" }];
}

// ─── Snapshot views ─────────────────────────────────────────────────────────

export function currentAllFilters(): HubSpotFilter[] {
  return [ACTIVE];
}

export function primaryBaseFilters(): HubSpotFilter[] {
  return [
    ACTIVE,
    { propertyName: "spouse__partner", operator: "EQ", value: "0" },
  ];
}

export function currentSecondaryFilters(): HubSpotFilter[] {
  return [
    ACTIVE,
    { propertyName: "spouse__partner", operator: "GT", value: "0" },
  ];
}

// ─── Period views ────────────────────────────────────────────────────────────

export function newJoinersFilters(start: string, end: string): HubSpotFilter[] {
  return [
    ACTIVE,
    { propertyName: "temp_smb_boardroom_date_joined", operator: "GTE", value: toEpochMs(start) },
    { propertyName: "temp_smb_boardroom_date_joined", operator: "LTE", value: toEpochMs(end, true) },
  ];
}

export function newJoinersPrimaryFilters(start: string, end: string): HubSpotFilter[] {
  return [
    ACTIVE,
    { propertyName: "spouse__partner",                operator: "EQ",  value: "0" },
    { propertyName: "temp_smb_boardroom_date_joined", operator: "GTE", value: toEpochMs(start) },
    { propertyName: "temp_smb_boardroom_date_joined", operator: "LTE", value: toEpochMs(end, true) },
  ];
}

export function newJoinersSecondaryFilters(start: string, end: string): HubSpotFilter[] {
  return [
    ACTIVE,
    { propertyName: "spouse__partner",                operator: "GT",  value: "0" },
    { propertyName: "temp_smb_boardroom_date_joined", operator: "GTE", value: toEpochMs(start) },
    { propertyName: "temp_smb_boardroom_date_joined", operator: "LTE", value: toEpochMs(end, true) },
  ];
}

/** Churned — temp_smbb_access_revoked = true (period ignored; no revocation date property) */
export function churnedFilters(_start: string, _end: string): HubSpotFilter[] {
  return [{ propertyName: "temp_smbb_access_revoked", operator: "EQ", value: "true" }];
}

/** Actual Renewals — no renewal date property found in portal; always returns 0 */
export function renewalActualFilters(_start: string, _end: string): HubSpotFilter[] {
  return impossibleFilter();
}

export function renewalActualMultiFilters(start: string, end: string): HubSpotFilter[][] {
  return [renewalActualFilters(start, end)];
}

/** Eligible Renewals (past) — expiration date in period (any status) */
export function eligibleRenewalFilters(start: string, end: string): HubSpotFilter[] {
  return [
    { propertyName: "temp_smb_boardroom_expiration_date", operator: "GTE", value: toEpochMs(start) },
    { propertyName: "temp_smb_boardroom_expiration_date", operator: "LTE", value: toEpochMs(end, true) },
  ];
}

/** Eligible Renewals (current/future) — active + expiration date in period */
export function eligibleRenewalActiveFilters(start: string, end: string): HubSpotFilter[] {
  return [
    ACTIVE,
    { propertyName: "temp_smb_boardroom_expiration_date", operator: "GTE", value: toEpochMs(start) },
    { propertyName: "temp_smb_boardroom_expiration_date", operator: "LTE", value: toEpochMs(end, true) },
  ];
}

/** Refunded — no property found; always returns 0 */
export function refundedFilters(_start: string, _end: string): HubSpotFilter[] {
  return impossibleFilter();
}

/** Acquired a Business — no property found; always returns 0 */
export function acquiredBusinessFilters(): HubSpotFilter[][] {
  return [impossibleFilter()];
}

// ─── Properties to fetch ────────────────────────────────────────────────────

export const CONTACT_PROPERTIES = [
  "firstname",
  "lastname",
  "email",
  "active_boardroom_member",
  "active_academy_member",
  "spouse__partner",
  "temp_smb_boardroom_date_joined",
  "temp_smb_boardroom_expiration_date",
  "temp_smbb_access_revoked",
  "temp_smbb_council_status",
  "lastmodifieddate",
];
