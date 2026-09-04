"use client";

import { useState, useEffect, useCallback } from "react";
import {
  lifetimeFilters,
  currentAllFilters,
  primaryBaseFilters,
  spouseFilters,
  partnerFilters,
  acquiredBusinessFilters,
  churnedAllTimeFilters,
  renewalAllTimeFilters,
  refundedAllTimeFilters,
  cancellationsAllTimeFilters,
  newJoinersFilters,
  newJoinersPrimaryFilters,
  newJoinersSpouseFilters,
  newJoinersPartnerFilters,
  churnedFilters,
  renewalActualFilters,
  eligibleRenewalFilters,
  eligibleRenewalActiveFilters,
  refundedFilters,
  cancellationsFilters,
  withType,
  HubSpotFilter,
  CONTACT_PROPERTIES,
} from "@/lib/tokyo-filters";
import {
  getPeriodRange,
  getSpecificMonthOptions,
  getNextMonthOptions,
  currentMonthValue,
  PeriodState,
  PeriodType,
} from "@/lib/period";

const PORTAL_ID = "51278247";

export type ViewKey =
  // Snapshot (all-time)
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
  // Period
  | "new"
  | "churned"
  | "renewal"
  | "eligible"
  | "refunded"
  | "cancellations";

interface Contact {
  id: string;
  properties: Record<string, string | null>;
}

type ReportGranularity = "monthly" | "quarterly" | "yearly";

interface ReportRow {
  label: string;
  start: string;
  end: string;
  newPrimary: number | null;
  newSecondary: number | null;
  churned: number | null;
  refunded: number | null;
  actual: number | null;
  eligible: number | null;
}

const EMPTY_ROW_COUNTS = { newPrimary: null, newSecondary: null, churned: null, refunded: null, actual: null, eligible: null };

function generateReportPeriods(granularity: ReportGranularity, year: number): ReportRow[] {
  function pad(n: number) { return n.toString().padStart(2, "0"); }
  function lastDay(y: number, m: number) { return new Date(y, m, 0).getDate(); }

  if (granularity === "monthly") {
    return Array.from({ length: 12 }, (_, i) => {
      const m = i + 1;
      const label = new Date(year, i, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
      return { label, start: `${year}-${pad(m)}-01`, end: `${year}-${pad(m)}-${pad(lastDay(year, m))}`, ...EMPTY_ROW_COUNTS };
    });
  }
  if (granularity === "quarterly") {
    return [1, 2, 3, 4].map((q) => {
      const sm = (q - 1) * 3 + 1;
      const em = q * 3;
      return { label: `Q${q} ${year}`, start: `${year}-${pad(sm)}-01`, end: `${year}-${pad(em)}-${pad(lastDay(year, em))}`, ...EMPTY_ROW_COUNTS };
    });
  }
  // yearly — last 4 years up to current
  const currentYear = new Date().getFullYear();
  return Array.from({ length: 4 }, (_, i) => {
    const y = currentYear - 3 + i;
    return { label: `${y}`, start: `${y}-01-01`, end: `${y}-12-31`, ...EMPTY_ROW_COUNTS };
  });
}

interface State {
  tab: "report" | "members" | "methodology" | "renewals";
  period: PeriodType;
  customStart: string | null;
  customEnd: string | null;
  specificMonth: string;
  activeView: ViewKey;
  counts: Record<ViewKey, number | null>;
  rows: Record<ViewKey, Contact[]>;
  totals: Record<ViewKey, number | null>;
  offsets: Record<ViewKey, string | undefined>;
  loadingMore: boolean;
  newBreakdown: { primary: number | null; spouse: number | null; partner: number | null };
}

type LoadingMap = Record<ViewKey, boolean>;

const cache = new Map<string, { data: HubSpotResult; ts: number }>();
const CACHE_TTL = 30_000;

// ── localStorage cache for past report periods ────────────────────────────────
// Past months never change, so we store them indefinitely across sessions.
type StoredRowCounts = Pick<ReportRow, "newPrimary" | "newSecondary" | "churned" | "refunded" | "actual" | "eligible">;

function lsKey(start: string, end: string, type: string): string {
  return `tokyo_report_${type}_${start}_${end}`;
}

function getStoredPeriod(start: string, end: string, type: string): StoredRowCounts | null {
  try {
    const raw = localStorage.getItem(lsKey(start, end, type));
    if (!raw) return null;
    return JSON.parse(raw) as StoredRowCounts;
  } catch {
    return null;
  }
}

function storePeriod(start: string, end: string, type: string, data: StoredRowCounts): void {
  try {
    localStorage.setItem(lsKey(start, end, type), JSON.stringify(data));
  } catch {
    // localStorage full or unavailable — silently skip
  }
}

interface HubSpotResult {
  total: number;
  results: Contact[];
  paging?: { next?: { after: string } };
}

function cacheKey(filters: HubSpotFilter[], after?: string): string {
  return JSON.stringify({ filters, after });
}

async function searchContacts(filters: HubSpotFilter[] | HubSpotFilter[][], after?: string, attempt = 0): Promise<HubSpotResult> {
  const key = cacheKey(filters as HubSpotFilter[], after);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const filterGroups = Array.isArray(filters[0])
    ? (filters as HubSpotFilter[][]).map((f) => ({ filters: f }))
    : [{ filters: filters as HubSpotFilter[] }];

  const res = await fetch("/api/hubspot-search-tokyo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filterGroups,
      properties: CONTACT_PROPERTIES,
      limit: 100,
      after,
    }),
  });

  if (!res.ok) {
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      return searchContacts(filters, after, attempt + 1);
    }
    throw new Error(`API error ${res.status}`);
  }
  const data: HubSpotResult = await res.json();
  cache.set(key, { data, ts: Date.now() });
  return data;
}



function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  // Force UTC so epoch-ms date properties (stored as midnight UTC) don't shift
  // to the previous day when interpreted in US timezones.
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function fmtName(c: Contact): string {
  return c.properties.member_name?.trim() || c.properties.bdrm_login_email || c.id;
}

function hubspotUrl(id: string): string {
  return `https://app.hubspot.com/contacts/${PORTAL_ID}/record/2-61595094/${id}`;
}

function csvEscape(v: string | null | undefined): string {
  return `"${(v ?? "").replace(/"/g, '""')}"`;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function last30Days(): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

const ALL_VIEWS: ViewKey[] = [
  "lifetime", "current", "primary", "spouse", "partner", "acquired",
  "churnedAll", "renewalAll", "refundedAll", "cancellationsAll",
  "new", "churned", "renewal", "eligible", "refunded", "cancellations",
];

function makeNullRecord<T>(val: T): Record<ViewKey, T> {
  return Object.fromEntries(ALL_VIEWS.map((k) => [k, val])) as Record<ViewKey, T>;
}

function Badge({ color, text }: { color: string; text: string }) {
  const palette: Record<string, [string, string]> = {
    green:  ["#dcfce7", "#166534"],
    cyan:   ["#cffafe", "#155e75"],
    purple: ["#ede9fe", "#5b21b6"],
    blue:   ["#dbeafe", "#1e40af"],
    red:    ["#fee2e2", "#991b1b"],
    yellow: ["#fef9c3", "#854d0e"],
    rose:   ["#ffe4e6", "#9f1239"],
    orange: ["#ffedd5", "#9a3412"],
    black:  ["#f3f4f6", "#111827"],
    pink:   ["#fce7f3", "#9d174d"],
  };
  const [bg, fg] = palette[color] ?? palette.black;
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: "9999px", fontSize: "11px", fontWeight: 600, background: bg, color: fg }}>
      {text}
    </span>
  );
}

function StatCard({ title, subtitle, badge, badgeColor, count, displayValue, isLoading, active, onClick, clickable = true, note }: {
  title: string; subtitle?: string; badge: string; badgeColor: string;
  count: number | null; displayValue?: string; isLoading: boolean; active: boolean; onClick?: () => void;
  clickable?: boolean; note?: string;
}) {
  return (
    <div onClick={clickable ? onClick : undefined} style={{
      background: "#fff",
      border: active ? "2px solid #1a1a1a" : "1px solid #e6e6e3",
      borderRadius: "12px",
      padding: active ? "15px" : "16px",
      cursor: clickable ? "pointer" : "default",
      transition: "border-color 0.15s",
      minWidth: 0,
    }}>
      <div style={{ marginBottom: "12px" }}><Badge color={badgeColor} text={badge} /></div>
      <div style={{ fontSize: "32px", fontWeight: 700, letterSpacing: "-0.02em", color: "#1a1a1a", lineHeight: 1, marginBottom: "6px" }}>
        {isLoading ? <span style={{ color: "#ccc", fontSize: "24px" }}>···</span>
          : displayValue ?? (count !== null ? count.toLocaleString() : "—")}
      </div>
      <div style={{ fontSize: "13px", fontWeight: 600, color: "#1a1a1a" }}>{title}</div>
      {subtitle && <div style={{ fontSize: "12px", color: "#666", marginTop: "2px" }}>{subtitle}</div>}
      {note && <div style={{ fontSize: "11px", color: "#b45309", marginTop: "6px", background: "#fef9c3", padding: "4px 8px", borderRadius: "4px" }}>{note}</div>}
    </div>
  );
}

function viewFilters(view: ViewKey, start: string, end: string, productType: string | null): HubSpotFilter[][] {
  const today = new Date().toISOString().slice(0, 10);
  const isPast = end < today;
  let filters: HubSpotFilter[] | HubSpotFilter[][];
  switch (view) {
    // Snapshot
    case "lifetime":          filters = lifetimeFilters(); break;
    case "current":           filters = currentAllFilters(); break;
    case "primary":           filters = primaryBaseFilters(); break;
    case "spouse":            filters = spouseFilters(); break;
    case "partner":           filters = partnerFilters(); break;
    case "acquired":          filters = acquiredBusinessFilters(); break;
    case "churnedAll":        filters = churnedAllTimeFilters(); break;
    case "renewalAll":        filters = renewalAllTimeFilters(); break;
    case "refundedAll":       filters = refundedAllTimeFilters(); break;
    case "cancellationsAll":  filters = cancellationsAllTimeFilters(); break;
    // Period
    case "new":               filters = newJoinersFilters(start, end); break;
    case "churned":           filters = churnedFilters(start, end); break;
    case "renewal":           filters = renewalActualFilters(start, end); break;
    case "eligible":          filters = isPast ? eligibleRenewalFilters(start, end) : eligibleRenewalActiveFilters(start, end); break;
    case "refunded":          filters = refundedFilters(start, end); break;
    case "cancellations":     filters = cancellationsFilters(start, end); break;
  }
  return productType ? withType(filters, productType) : (Array.isArray(filters[0]) ? filters as HubSpotFilter[][] : [filters as HubSpotFilter[]]);
}

function fmtPrice(v: string | null | undefined): string {
  if (!v || v.trim() === "") return "—";
  const n = parseFloat(v);
  if (isNaN(n)) return v;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

type TableCol = { label: string; value: (c: Contact) => string; sortKey?: (c: Contact) => string };

/** Return the ISO date string for the Monday of the week containing the given raw HubSpot date value. */
function getWeekStartStr(rawDateVal: string | null | undefined): string | null {
  if (!rawDateVal) return null;
  const ms = new Date(rawDateVal).getTime();
  if (isNaN(ms)) return null;
  const d = new Date(ms);
  const dow = d.getUTCDay(); // 0=Sun
  d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return d.toISOString().slice(0, 10);
}

/** Return all Mon–Sun week buckets that overlap with the given period (YYYY-MM-DD). */
function getWeeksInRange(start: string, end: string): { ws: string; we: string; label: string }[] {
  const d = new Date(start + "T00:00:00Z");
  const endMs = new Date(end + "T00:00:00Z").getTime();
  // Back up to Monday
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  const weeks: { ws: string; we: string; label: string }[] = [];
  while (d.getTime() <= endMs) {
    const wsStr = d.toISOString().slice(0, 10);
    const we = new Date(d); we.setUTCDate(d.getUTCDate() + 6);
    const weStr = we.toISOString().slice(0, 10);
    const fmtD = (dt: Date) => dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    const label = d.getUTCMonth() === we.getUTCMonth()
      ? `${fmtD(d).replace(/\s\d+$/, "")} ${d.getUTCDate()}–${we.getUTCDate()}`
      : `${fmtD(d)} – ${fmtD(we)}`;
    weeks.push({ ws: wsStr, we: weStr, label });
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return weeks;
}

function dateSort(prop: string): (c: Contact) => string {
  return (c) => {
    const v = c.properties[prop];
    if (!v) return "0";
    const ms = new Date(v).getTime();
    return isNaN(ms) ? "0" : String(ms);
  };
}

function tableColumns(view: ViewKey): TableCol[] {
  const nameCol:     TableCol = { label: "Name",            value: fmtName };
  const emailCol:    TableCol = { label: "Email",           value: (c) => c.properties.bdrm_login_email ?? "—" };
  const statusCol:   TableCol = { label: "Status",          value: (c) => c.properties.status ?? "—" };
  const typeCol:     TableCol = { label: "Type",            value: (c) => c.properties.membership_type ?? "—" };
  const joinCol:     TableCol = { label: "Date Joined",     value: (c) => fmtDate(c.properties.start_date_v2),        sortKey: dateSort("start_date_v2") };
  const renewalCol:  TableCol = { label: "Renewal Date",    value: (c) => fmtDate(c.properties.actual_renewal_date),  sortKey: dateSort("actual_renewal_date") };
  const eligibleCol: TableCol = { label: "Expected Renewal",value: (c) => fmtDate(c.properties.expected_renewal_date),sortKey: dateSort("expected_renewal_date") };
  const priceCol:    TableCol = { label: "Price",           value: (c) => fmtPrice(c.properties.renewal_price) };
  const revokedCol:   TableCol = { label: "Revoked Date",   value: (c) => fmtDate(c.properties.revocation_date),        sortKey: dateSort("revocation_date") };
  const inactiveCol:  TableCol = { label: "End Date",        value: (c) => fmtDate(c.properties.membership_inactive_date), sortKey: dateSort("membership_inactive_date") };
  const endDateCol:   TableCol = { label: "End Date",        value: (c) => fmtDate(c.properties.membership_inactive_date ?? c.properties.revocation_date), sortKey: dateSort("membership_inactive_date") };
  const cancelledCol: TableCol = { label: "Revoked Date",    value: (c) => fmtDate(c.properties.revocation_date),        sortKey: dateSort("revocation_date") };

  switch (view) {
    case "churned":
    case "churnedAll":
      return [nameCol, emailCol, statusCol, typeCol, inactiveCol, joinCol];
    case "renewal":
    case "renewalAll":
      return [nameCol, emailCol, statusCol, typeCol, renewalCol, priceCol];
    case "eligible":
      return [nameCol, emailCol, statusCol, typeCol, eligibleCol, priceCol];
    case "refunded":
    case "refundedAll":
      return [nameCol, emailCol, statusCol, typeCol, inactiveCol, priceCol];
    case "cancellations":
    case "cancellationsAll":
      return [nameCol, emailCol, statusCol, typeCol, cancelledCol, joinCol];
    case "acquired":
      return [nameCol, emailCol, statusCol, typeCol, joinCol];
    default:
      return [nameCol, emailCol, statusCol, typeCol, joinCol, endDateCol, eligibleCol];
  }
}

const VIEW_TITLES: Record<ViewKey, string> = {
  lifetime:          "Lifetime Members",
  current:           "Current Active Members",
  primary:           "Current Active — Primary",
  spouse:            "Current Active — Spouse",
  partner:           "Current Active — Business Partner",
  acquired:          "Business Acquisitions",
  churnedAll:        "Churned (All Time)",
  renewalAll:        "Actual Renewals (All Time)",
  refundedAll:       "Refunds (All Time)",
  cancellationsAll:  "Cancellations (All Time)",
  new:               "New Joiners",
  churned:           "Churned",
  renewal:           "Actual Renewals",
  eligible:          "Expected Renewals",
  refunded:          "Refunds",
  cancellations:     "Cancellations",
};

function PeriodBar({ state, customTempStart, customTempEnd, setCustomTempStart, setCustomTempEnd, onSetPeriod, onApplyCustom, pastMonths, nextMonths, onSetSpecificMonth }: {
  state: State;
  customTempStart: string; customTempEnd: string;
  setCustomTempStart: (v: string) => void; setCustomTempEnd: (v: string) => void;
  onSetPeriod: (p: PeriodType) => void; onApplyCustom: () => void;
  pastMonths: { value: string; label: string }[];
  nextMonths: { value: string; label: string }[];
  onSetSpecificMonth: (v: string) => void;
}) {
  const buttons: { key: PeriodType; label: string }[] = [
    { key: "week", label: "This Week" },
    { key: "month", label: "This Month" },
    { key: "quarter", label: "This Quarter" },
    { key: "year", label: "This Year" },
    { key: "custom", label: "Custom" },
    { key: "specific", label: "Specific Month" },
  ];

  return (
    <div style={{ marginBottom: "24px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
        <span style={{ fontSize: "12px", fontWeight: 600, color: "#666", marginRight: "4px" }}>Period:</span>
        {buttons.map(({ key, label }) => (
          <button key={key} onClick={() => onSetPeriod(key)} style={{
            padding: "6px 14px", borderRadius: "6px", border: "1px solid #e6e6e3",
            background: state.period === key ? "#1a1a1a" : "#fff",
            color: state.period === key ? "#fff" : "#1a1a1a",
            fontSize: "13px", fontWeight: 500, cursor: "pointer",
          }}>{label}</button>
        ))}
      </div>

      {state.period === "custom" && (
        <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "10px", flexWrap: "wrap" }}>
          <input type="date" value={customTempStart} onChange={(e) => setCustomTempStart(e.target.value)}
            style={{ padding: "6px 10px", border: "1px solid #e6e6e3", borderRadius: "6px", fontSize: "13px" }} />
          <span style={{ color: "#666" }}>→</span>
          <input type="date" value={customTempEnd} onChange={(e) => setCustomTempEnd(e.target.value)}
            style={{ padding: "6px 10px", border: "1px solid #e6e6e3", borderRadius: "6px", fontSize: "13px" }} />
          <button onClick={onApplyCustom} style={{
            padding: "6px 14px", background: "#1a1a1a", color: "#fff", border: "none",
            borderRadius: "6px", fontSize: "13px", fontWeight: 600, cursor: "pointer",
          }}>Apply</button>
        </div>
      )}

      {state.period === "specific" && (
        <div style={{ marginTop: "10px" }}>
          <select value={state.specificMonth} onChange={(e) => onSetSpecificMonth(e.target.value)}
            style={{ padding: "6px 10px", border: "1px solid #e6e6e3", borderRadius: "6px", fontSize: "13px", background: "#fff", color: "#1a1a1a", minWidth: "200px" }}>
            <option value="all">All future</option>
            <option value={currentMonthValue()}>{new Date().toLocaleString("en-US", { month: "long", year: "numeric" })} (this month)</option>
            <optgroup label="Next 12 months">
              {nextMonths.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </optgroup>
            <optgroup label="Past 12 months">
              {pastMonths.slice(1).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </optgroup>
          </select>
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const { start: d30start, end: d30end } = last30Days();

  const [state, setState] = useState<State>({
    tab: "members",
    period: "month",
    customStart: d30start,
    customEnd: d30end,
    specificMonth: currentMonthValue(),
    activeView: "new" as ViewKey,
    counts: makeNullRecord(null),
    rows: makeNullRecord([]) as Record<ViewKey, Contact[]>,
    totals: makeNullRecord(null),
    offsets: makeNullRecord(undefined) as Record<ViewKey, string | undefined>,
    loadingMore: false,
    newBreakdown: { primary: null, spouse: null, partner: null },
  });

  const [loading, setLoading] = useState<LoadingMap>(makeNullRecord(true) as LoadingMap);
  const [customTempStart, setCustomTempStart] = useState(d30start);
  const [customTempEnd, setCustomTempEnd] = useState(d30end);
  const [downloadProgress, setDownloadProgress] = useState<string | null>(null);
  const [productType, setProductType] = useState<string>("Academy");

  // ── Summary Report state ──────────────────────────────────────────────────
  const [reportGranularity, setReportGranularity] = useState<ReportGranularity>("monthly");
  const [reportYear, setReportYear] = useState(new Date().getFullYear());
  const [reportRows, setReportRows] = useState<ReportRow[]>([]);
  const [reportLoading, setReportLoading] = useState(false);

  // ── Contact list sort state ───────────────────────────────────────────────
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [excludeCT, setExcludeCT] = useState(false);

  // ── Eligible Renewals breakdown tab state ─────────────────────────────────
  const [eligBreakdownContacts, setEligBreakdownContacts] = useState<Contact[]>([]);
  const [eligBreakdownLoading, setEligBreakdownLoading] = useState(false);
  const [eligBreakdownTotal, setEligBreakdownTotal] = useState<number | null>(null);
  const [eligActualContacts, setEligActualContacts] = useState<Contact[]>([]);
  const [eligActualLoading, setEligActualLoading] = useState(false);

  const periodState: PeriodState = {
    period: state.period,
    customStart: state.customStart,
    customEnd: state.customEnd,
    specificMonth: state.specificMonth,
  };
  const range = getPeriodRange(periodState);

  const renewalRate =
    state.counts.eligible !== null && state.counts.renewal !== null && (state.counts.eligible + state.counts.renewal) > 0
      ? ((state.counts.renewal / (state.counts.eligible + state.counts.renewal)) * 100).toFixed(1) + "%"
      : "—";

  const loadSnapshotViews = useCallback(async (pt: string) => {
    const isAcademy = pt === "Academy";
    setLoading((l) => ({ ...l, lifetime: true, current: true, primary: true, spouse: true, partner: true, acquired: isAcademy, churnedAll: true, renewalAll: true, refundedAll: true, cancellationsAll: true }));
    const acqPromise = isAcademy ? searchContacts(withType(acquiredBusinessFilters(), pt)) : Promise.resolve(null as HubSpotResult | null);
    const [life, all, prim, spo, part, acq, chAll, renAll, refAll, canAll] = await Promise.allSettled([
      searchContacts(withType(lifetimeFilters(), pt)),
      searchContacts(withType(currentAllFilters(), pt)),
      searchContacts(withType(primaryBaseFilters(), pt)),
      searchContacts(withType(spouseFilters(), pt)),
      searchContacts(withType(partnerFilters(), pt)),
      acqPromise,
      searchContacts(withType(churnedAllTimeFilters(), pt)),
      searchContacts(withType(renewalAllTimeFilters(), pt)),
      searchContacts(withType(refundedAllTimeFilters(), pt)),
      searchContacts(withType(cancellationsAllTimeFilters(), pt)),
    ]);
    setState((s) => {
      const snap = (r: PromiseSettledResult<HubSpotResult | null>) =>
        r.status === "fulfilled" ? r.value : null;
      return {
        ...s,
        counts: { ...s.counts,
          lifetime: snap(life)?.total ?? null, current: snap(all)?.total ?? null,
          primary: snap(prim)?.total ?? null, spouse: snap(spo)?.total ?? null, partner: snap(part)?.total ?? null,
          acquired: isAcademy ? (snap(acq)?.total ?? null) : null,
          churnedAll: snap(chAll)?.total ?? null, renewalAll: snap(renAll)?.total ?? null,
          refundedAll: snap(refAll)?.total ?? null, cancellationsAll: snap(canAll)?.total ?? null,
        },
        rows: { ...s.rows,
          lifetime: snap(life)?.results ?? [], current: snap(all)?.results ?? [],
          primary: snap(prim)?.results ?? [], spouse: snap(spo)?.results ?? [], partner: snap(part)?.results ?? [],
          acquired: snap(acq)?.results ?? [],
          churnedAll: snap(chAll)?.results ?? [], renewalAll: snap(renAll)?.results ?? [],
          refundedAll: snap(refAll)?.results ?? [], cancellationsAll: snap(canAll)?.results ?? [],
        },
        totals: { ...s.totals,
          lifetime: snap(life)?.total ?? null, current: snap(all)?.total ?? null,
          primary: snap(prim)?.total ?? null, spouse: snap(spo)?.total ?? null, partner: snap(part)?.total ?? null,
          acquired: isAcademy ? (snap(acq)?.total ?? null) : null,
          churnedAll: snap(chAll)?.total ?? null, renewalAll: snap(renAll)?.total ?? null,
          refundedAll: snap(refAll)?.total ?? null, cancellationsAll: snap(canAll)?.total ?? null,
        },
        offsets: { ...s.offsets,
          lifetime: snap(life)?.paging?.next?.after, current: snap(all)?.paging?.next?.after,
          primary: snap(prim)?.paging?.next?.after, spouse: snap(spo)?.paging?.next?.after, partner: snap(part)?.paging?.next?.after,
          acquired: snap(acq)?.paging?.next?.after,
          churnedAll: snap(chAll)?.paging?.next?.after, renewalAll: snap(renAll)?.paging?.next?.after,
          refundedAll: snap(refAll)?.paging?.next?.after, cancellationsAll: snap(canAll)?.paging?.next?.after,
        },
      };
    });
    setLoading((l) => ({ ...l, lifetime: false, current: false, primary: false, spouse: false, partner: false, acquired: false, churnedAll: false, renewalAll: false, refundedAll: false, cancellationsAll: false }));
  }, []);

  const loadPeriodViews = useCallback(async (start: string, end: string, pt: string) => {
    setLoading((l) => ({ ...l, new: true, churned: true, renewal: true, eligible: true, refunded: true, cancellations: true }));
    setState((s) => ({
      ...s,
      counts:  { ...s.counts,  new: null, churned: null, renewal: null, eligible: null, refunded: null, cancellations: null },
      rows:    { ...s.rows,    new: [],   churned: [],   renewal: [],   eligible: [],   refunded: [],   cancellations: [] },
      totals:  { ...s.totals,  new: null, churned: null, renewal: null, eligible: null, refunded: null, cancellations: null },
      offsets: { ...s.offsets, new: undefined, churned: undefined, renewal: undefined, eligible: undefined, refunded: undefined, cancellations: undefined },
      newBreakdown: { primary: null, spouse: null, partner: null },
    }));

    const today = new Date().toISOString().slice(0, 10);
    const isPast = end < today;
    const eligFilters = withType(isPast ? eligibleRenewalFilters(start, end) : eligibleRenewalActiveFilters(start, end), pt);
    const [newJ, churn, renew, elig, refund, cancels, newPrim, newSpo, newPart] = await Promise.allSettled([
      searchContacts(withType(newJoinersFilters(start, end), pt)),
      searchContacts(withType(churnedFilters(start, end), pt)),
      searchContacts(withType(renewalActualFilters(start, end), pt)),
      searchContacts(eligFilters),
      searchContacts(withType(refundedFilters(start, end), pt)),
      searchContacts(withType(cancellationsFilters(start, end), pt)),
      searchContacts(withType(newJoinersPrimaryFilters(start, end), pt)),
      searchContacts(withType(newJoinersSpouseFilters(start, end), pt)),
      searchContacts(withType(newJoinersPartnerFilters(start, end), pt)),
    ]);

    setState((s) => {
      const v = (r: PromiseSettledResult<HubSpotResult>) => r.status === "fulfilled" ? r.value : null;
      return {
        ...s,
        counts:  { ...s.counts,  new: v(newJ)?.total ?? null, churned: v(churn)?.total ?? null, renewal: v(renew)?.total ?? null, eligible: v(elig)?.total ?? null, refunded: v(refund)?.total ?? null, cancellations: v(cancels)?.total ?? null },
        rows:    { ...s.rows,    new: v(newJ)?.results ?? [], churned: v(churn)?.results ?? [], renewal: v(renew)?.results ?? [], eligible: v(elig)?.results ?? [], refunded: v(refund)?.results ?? [], cancellations: v(cancels)?.results ?? [] },
        totals:  { ...s.totals,  new: v(newJ)?.total ?? null, churned: v(churn)?.total ?? null, renewal: v(renew)?.total ?? null, eligible: v(elig)?.total ?? null, refunded: v(refund)?.total ?? null, cancellations: v(cancels)?.total ?? null },
        offsets: { ...s.offsets, new: v(newJ)?.paging?.next?.after, churned: v(churn)?.paging?.next?.after, renewal: v(renew)?.paging?.next?.after, eligible: v(elig)?.paging?.next?.after, refunded: v(refund)?.paging?.next?.after, cancellations: v(cancels)?.paging?.next?.after },
        newBreakdown: { primary: v(newPrim)?.total ?? null, spouse: v(newSpo)?.total ?? null, partner: v(newPart)?.total ?? null },
      };
    });
    setLoading((l) => ({ ...l, new: false, churned: false, renewal: false, eligible: false, refunded: false, cancellations: false }));
  }, []);

  const loadReport = useCallback(async (granularity: ReportGranularity, year: number, pt: string) => {
    const periods = generateReportPeriods(granularity, year);
    setReportRows(periods.map((p) => ({ ...p, ...EMPTY_ROW_COUNTS })));
    setReportLoading(true);

    const todayISO2 = new Date().toISOString().slice(0, 10);

    for (let i = 0; i < periods.length; i++) {
      const p = periods[i];
      const isPast = p.end < todayISO2;

      if (isPast) {
        const stored = getStoredPeriod(p.start, p.end, pt);
        if (stored) {
          setReportRows((rows) => rows.map((row, j) => j !== i ? row : { ...row, ...stored }));
          continue;
        }
      }

      const eligFilters = withType(isPast ? eligibleRenewalFilters(p.start, p.end) : eligibleRenewalActiveFilters(p.start, p.end), pt);
      try {
        const [newPrim, newSpo, newPart, churn, refund, actual, eligible] = await Promise.all([
          searchContacts(withType(newJoinersPrimaryFilters(p.start, p.end), pt)),
          searchContacts(withType(newJoinersSpouseFilters(p.start, p.end), pt)),
          searchContacts(withType(newJoinersPartnerFilters(p.start, p.end), pt)),
          searchContacts(withType(churnedFilters(p.start, p.end), pt)),
          searchContacts(withType(refundedFilters(p.start, p.end), pt)),
          searchContacts(withType(renewalActualFilters(p.start, p.end), pt)),
          searchContacts(eligFilters),
        ]);
        const counts: StoredRowCounts = {
          newPrimary:   newPrim.total   ?? newPrim.results.length,
          newSecondary: (newSpo.total ?? newSpo.results.length) + (newPart.total ?? newPart.results.length),
          churned:      churn.total     ?? churn.results.length,
          refunded:     refund.total    ?? refund.results.length,
          actual:       actual.total    ?? actual.results.length,
          eligible:     eligible.total  ?? eligible.results.length,
        };
        setReportRows((rows) => rows.map((row, j) => j !== i ? row : { ...row, ...counts }));
        if (isPast) storePeriod(p.start, p.end, pt, counts);
      } catch {
        // leave this row as EMPTY_ROW_COUNTS
      }
    }

    setReportLoading(false);
  }, []);

  const loadEligBreakdown = useCallback(async (start: string, end: string, pt: string) => {
    setEligBreakdownLoading(true);
    setEligBreakdownContacts([]);
    setEligBreakdownTotal(null);

    const today = new Date().toISOString().slice(0, 10);
    const isPast = end < today;
    const filters = withType(isPast ? eligibleRenewalFilters(start, end) : eligibleRenewalActiveFilters(start, end), pt);

    let all: Contact[] = [];
    let after: string | undefined;
    let total: number | null = null;

    try {
      do {
        const data = await searchContacts(filters, after);
        if (total === null) total = data.total;
        all = [...all, ...data.results];
        after = data.paging?.next?.after;
        setEligBreakdownContacts([...all]);
        setEligBreakdownTotal(total);
      } while (after);
    } catch {
      // leave whatever was loaded
    }

    setEligBreakdownLoading(false);
  }, []);

  const loadEligActualRenewals = useCallback(async (start: string, end: string, pt: string) => {
    setEligActualLoading(true);
    setEligActualContacts([]);
    let all: Contact[] = [];
    let after: string | undefined;
    try {
      do {
        const data = await searchContacts(withType(renewalActualFilters(start, end), pt), after);
        all = [...all, ...data.results];
        after = data.paging?.next?.after;
        setEligActualContacts([...all]);
      } while (after);
    } catch {
      // leave whatever was loaded
    }
    setEligActualLoading(false);
  }, []);

  useEffect(() => { loadSnapshotViews(productType); }, [loadSnapshotViews, productType]);
  useEffect(() => { loadPeriodViews(range.start, range.end, productType); }, // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.period, state.customStart, state.customEnd, state.specificMonth, productType]);
  useEffect(() => {
    if (state.tab === "report") loadReport(reportGranularity, reportYear, productType);
  }, [state.tab, reportGranularity, reportYear, loadReport, productType]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (state.tab === "renewals") {
      loadEligBreakdown(range.start, range.end, productType);
      loadEligActualRenewals(range.start, range.end, productType);
    }
  }, // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.tab, state.period, state.customStart, state.customEnd, state.specificMonth, productType]);

  async function loadMore() {
    const view = state.activeView;
    const after = state.offsets[view];
    if (!after || state.loadingMore) return;
    setState((s) => ({ ...s, loadingMore: true }));
    const data = await searchContacts(viewFilters(view, range.start, range.end, productType), after).catch(() => null);
    if (data) {
      setState((s) => ({
        ...s,
        rows:    { ...s.rows,    [view]: [...s.rows[view],    ...data.results] },
        offsets: { ...s.offsets, [view]: data.paging?.next?.after },
        loadingMore: false,
      }));
    } else {
      setState((s) => ({ ...s, loadingMore: false }));
    }
  }

  function exportReportCSV() {
    const header = ["Period", "New Primary", "New Secondary", "Total New Members", "Churned", "Refunded", "Actual Renewals", "Eligible Renewals", "Renewal Rate"].map(csvEscape).join(",");
    const lines = reportRows.map((r) => {
      const renewalRate = r.actual !== null && r.eligible !== null && (r.eligible + r.actual) > 0
        ? ((r.actual / (r.eligible + r.actual)) * 100).toFixed(1) + "%" : "—";
      const totalNew = r.newPrimary !== null && r.newSecondary !== null ? String(r.newPrimary + r.newSecondary) : "";
      return [
        r.label,
        String(r.newPrimary ?? ""),
        String(r.newSecondary ?? ""),
        totalNew,
        String(r.churned ?? ""),
        String(r.refunded ?? ""),
        String(r.actual ?? ""),
        String(r.eligible ?? ""),
        renewalRate,
      ].map(csvEscape).join(",");
    });
    const csv = [header, ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `tokyo_summary_report_${reportGranularity}_${reportYear}_${todayISO()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  function setPeriod(p: PeriodType) { setState((s) => ({ ...s, period: p })); }
  function applyCustom() { setState((s) => ({ ...s, period: "custom", customStart: customTempStart, customEnd: customTempEnd })); }
  function setView(v: ViewKey) {
    setState((s) => ({ ...s, activeView: v }));
    setSortCol(null);
    setSortDir("asc");
  }

  function exportViewCSV() {
    const rows = state.rows[state.activeView];
    const cols = tableColumns(state.activeView);
    const header = cols.map((c) => csvEscape(c.label)).join(",");
    const lines = rows.map((c) => cols.map((col) => csvEscape(col.value(c))).join(","));
    const csv = [header, ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `tokyo_${state.activeView}_${todayISO()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  async function downloadFullReport() {
    setDownloadProgress("Starting full report…");
    const views: { key: ViewKey; title: string; snapshot: boolean }[] = [
      { key: "current",           title: "Current Members (All)",  snapshot: true  },
      { key: "primary",           title: "Current Primary",         snapshot: true  },
      { key: "spouse",            title: "Current Spouse",          snapshot: true  },
      { key: "partner",           title: "Current Business Partner",snapshot: true  },
      { key: "new",               title: "New Joiners",             snapshot: false },
      { key: "churned",           title: "Churned",                 snapshot: false },
      { key: "renewal",           title: "Renewals (Actual)",       snapshot: false },
      { key: "eligible",          title: "Eligible Renewals",       snapshot: false },
      { key: "refunded",          title: "Refunded",                snapshot: false },
      { key: "cancellations",     title: "Cancellations",           snapshot: false },
    ];
    const headers = ["Segment","Period / Month","HubSpot ID","HubSpot URL","Name","Email","Status","Membership Type","Date Joined","Actual Renewal","Expected Renewal","Owners Circle","Renewal Price"];
    const allLines: string[] = [headers.map(csvEscape).join(",")];

    for (const v of views) {
      const filters = viewFilters(v.key, range.start, range.end, productType);
      let after: string | undefined;
      let loaded = 0;
      let total: number | null = null;
      do {
        setDownloadProgress(`Fetching ${v.title}: ${loaded}${total !== null ? ` of ${total}` : ""}…`);
        const data = await searchContacts(filters, after);
        total = data.total;
        after = data.paging?.next?.after;
        loaded += data.results.length;
        for (const c of data.results) {
          allLines.push([
            v.title, v.snapshot ? "(all time)" : range.label, c.id, hubspotUrl(c.id),
            c.properties.member_name ?? "", c.properties.bdrm_login_email ?? "",
            c.properties.status ?? "", c.properties.membership_type ?? "",
            c.properties.start_date_v2 ?? "", c.properties.actual_renewal_date ?? "", c.properties.expected_renewal_date ?? "",
            c.properties.owners_circle ?? "", c.properties.renewal_price ?? "",
          ].map(csvEscape).join(","));
        }
      } while (after);
    }

    setDownloadProgress("Generating file…");
    const csv = allLines.join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `tokyo_full_report_${range.label.replace(/\s+/g, "_")}_${todayISO()}.csv`; a.click();
    URL.revokeObjectURL(url);
    setDownloadProgress(null);
  }

  const pastMonths = getSpecificMonthOptions();
  const nextMonths = getNextMonthOptions();
  const activeRows = state.rows[state.activeView] ?? [];
  const activeTotal = state.totals[state.activeView];
  const cols = tableColumns(state.activeView);

  function isCTEmail(email: string | null | undefined): boolean {
    if (!email) return false;
    const e = email.toLowerCase();
    return e.includes("@contrarianthink.com") || e.includes("@bizscout.com") || e.includes("test");
  }

  // Sort the visible rows client-side.
  // Date columns use sortKey (epoch ms) for numeric sort; price also sorts numerically.
  const sortedRows = (() => {
    const rows = excludeCT ? activeRows.filter((c) => !isCTEmail(c.properties.bdrm_login_email)) : activeRows;
    if (!sortCol) return rows;
    const col = cols.find((c) => c.label === sortCol);
    if (!col) return rows;
    return [...rows].sort((a, b) => {
      // Numeric sort for price and date columns
      if (sortCol === "Renewal Price" || col.sortKey) {
        const av = col.sortKey ? col.sortKey(a) : col.value(a);
        const bv = col.sortKey ? col.sortKey(b) : col.value(b);
        const an = parseFloat(av.replace(/[^0-9.]/g, ""));
        const bn = parseFloat(bv.replace(/[^0-9.]/g, ""));
        const diff = (isNaN(an) ? -Infinity : an) - (isNaN(bn) ? -Infinity : bn);
        return sortDir === "asc" ? diff : -diff;
      }
      const av = col.value(a);
      const bv = col.value(b);
      const cmp = av.localeCompare(bv);
      return sortDir === "asc" ? cmp : -cmp;
    });
  })();

  function handleSortClick(label: string) {
    if (sortCol === label) {
      setSortDir((d) => d === "asc" ? "desc" : "asc");
    } else {
      setSortCol(label);
      setSortDir("asc");
    }
  }

  const S = (style: React.CSSProperties) => style;

  return (
    <div style={S({ minHeight: "100vh", background: "#f7f7f5", fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', color: "#1a1a1a" })}>
      {/* Topbar */}
      <div style={S({ background: "#fff", borderBottom: "1px solid #e6e6e3", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px", position: "sticky", top: 0, zIndex: 10 })}>
        <div>
          <a href="/" style={S({ fontSize: "12px", color: "#666", textDecoration: "none", marginBottom: "4px", display: "inline-block" })}>← Contrarian Academy</a>
          <h1 style={S({ margin: 0, fontSize: "18px", fontWeight: 700 })}>🗼 Tokyo Members</h1>
          <p style={S({ margin: "2px 0 0", fontSize: "13px", color: "#666" })}>
            {state.counts.current !== null ? `${state.counts.current.toLocaleString()} current members` : "Loading…"}
            {state.counts.primary !== null ? ` · ${state.counts.primary.toLocaleString()} primary` : ""}
            {state.counts.spouse !== null ? ` · ${state.counts.spouse.toLocaleString()} spouse` : ""}
            {state.counts.partner !== null ? ` · ${state.counts.partner.toLocaleString()} partner` : ""}
          </p>
        </div>
        <div style={S({ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px" })}>
          {/* Product type selector */}
          <div style={S({ display: "flex", alignItems: "center", gap: "6px" })}>
            <span style={S({ fontSize: "11px", fontWeight: 600, color: "#666" })}>Product type:</span>
            {["Academy", "Boardroom", "AcqFound", "SFN", "Bundle"].map((t) => (
              <button key={t} onClick={() => setProductType(t)} style={S({
                padding: "4px 10px", borderRadius: "6px", border: "1px solid #e6e6e3",
                background: productType === t ? "#1a1a1a" : "#fff",
                color: productType === t ? "#fff" : "#1a1a1a",
                fontSize: "12px", fontWeight: 500, cursor: "pointer",
              })}>{t}</button>
            ))}
          </div>
          {/* CT team exclusion */}
          <label style={S({ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "12px", color: "#444", userSelect: "none" })}>
            <input type="checkbox" checked={excludeCT} onChange={(e) => setExcludeCT(e.target.checked)}
              style={S({ width: "14px", height: "14px", cursor: "pointer", accentColor: "#1a1a1a" })} />
            Exclude CT team
          </label>
          <button onClick={downloadFullReport} disabled={!!downloadProgress} style={S({ background: downloadProgress ? "#666" : "#1a1a1a", color: "#fff", border: "none", borderRadius: "8px", padding: "9px 16px", fontSize: "13px", fontWeight: 600, cursor: downloadProgress ? "not-allowed" : "pointer" })}>
            ⬇ Download Full Report (CSV)
          </button>
          {downloadProgress && <span style={S({ fontSize: "11px", color: "#666" })}>{downloadProgress}</span>}
        </div>
      </div>

      <div style={S({ padding: "24px", maxWidth: "1400px", margin: "0 auto" })}>
        {/* Tabs */}
        <div style={S({ display: "flex", gap: "4px", marginBottom: "24px" })}>
          {([
            { key: "members",     label: "Members" },
            { key: "report",      label: "Summary Report" },
            { key: "methodology", label: "Methodology" },
            { key: "renewals",    label: "Eligible Renewals" },
          ] as const).map(({ key, label }) => (
            <button key={key} onClick={() => setState((s) => ({ ...s, tab: key, activeView: "primary" }))}
              style={S({ padding: "8px 20px", borderRadius: "8px", border: "1px solid #e6e6e3", background: state.tab === key ? "#1a1a1a" : "#fff", color: state.tab === key ? "#fff" : "#1a1a1a", fontSize: "14px", fontWeight: 600, cursor: "pointer" })}>
              {label}
            </button>
          ))}
        </div>

        {state.tab === "members" && (
          <>
            {/* ── Snapshot (All Time) ─────────────────────────────────────────── */}
            <p style={S({ margin: "0 0 12px", fontSize: "12px", fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: "0.05em" })}>
              Membership Snapshot · All Time
            </p>

            {/* Snapshot grid — 5 cards per row */}
            <div style={S({ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "12px", marginBottom: "28px" })}>
              <StatCard title="Lifetime Members" subtitle="All members ever" badge="Lifetime" badgeColor="black" count={state.counts.lifetime} isLoading={loading.lifetime} active={state.activeView === "lifetime"} onClick={() => setView("lifetime")} />
              <StatCard title="Current Active" subtitle="Total Active or Grace" badge="All" badgeColor="green" count={state.counts.current} isLoading={loading.current} active={state.activeView === "current"} onClick={() => setView("current")} />
              <StatCard title="Primary" subtitle="Active/Grace — Primary" badge="Primary" badgeColor="cyan" count={state.counts.primary} isLoading={loading.primary} active={state.activeView === "primary"} onClick={() => setView("primary")} />
              <StatCard title="Spouse" subtitle="Active/Grace — Spouse" badge="Spouse" badgeColor="purple" count={state.counts.spouse} isLoading={loading.spouse} active={state.activeView === "spouse"} onClick={() => setView("spouse")} />
              <StatCard title="Business Partner" subtitle="Active/Grace — Partner" badge="Partner" badgeColor="indigo" count={state.counts.partner} isLoading={loading.partner} active={state.activeView === "partner"} onClick={() => setView("partner")} />
              {productType === "Academy" && (
                <StatCard title="Business Acquisitions" subtitle="owners_circle = true" badge="Acquired" badgeColor="orange" count={state.counts.acquired} isLoading={loading.acquired} active={state.activeView === "acquired"} onClick={() => setView("acquired")} />
              )}
              <StatCard title="Churned" subtitle="All inactive statuses ever" badge="All Time" badgeColor="red" count={state.counts.churnedAll} isLoading={loading.churnedAll} active={state.activeView === "churnedAll"} onClick={() => setView("churnedAll")} />
              <StatCard title="Actual Renewals" subtitle="Has an actual renewal date" badge="All Time" badgeColor="yellow" count={state.counts.renewalAll} isLoading={loading.renewalAll} active={state.activeView === "renewalAll"} onClick={() => setView("renewalAll")} />
              <StatCard title="Refunds" subtitle="Inactive – Refunded ever" badge="All Time" badgeColor="rose" count={state.counts.refundedAll} isLoading={loading.refundedAll} active={state.activeView === "refundedAll"} onClick={() => setView("refundedAll")} />
              <StatCard title="Cancellations" subtitle="Access revoked ever" badge="All Time" badgeColor="gray" count={state.counts.cancellationsAll} isLoading={loading.cancellationsAll} active={state.activeView === "cancellationsAll"} onClick={() => setView("cancellationsAll")} />
            </div>

            {/* ── Period ──────────────────────────────────────────────────────── */}
            <PeriodBar state={state} customTempStart={customTempStart} customTempEnd={customTempEnd}
              setCustomTempStart={setCustomTempStart} setCustomTempEnd={setCustomTempEnd}
              onSetPeriod={setPeriod} onApplyCustom={applyCustom}
              pastMonths={pastMonths} nextMonths={nextMonths}
              onSetSpecificMonth={(v) => setState((s) => ({ ...s, period: "specific", specificMonth: v }))} />

            <div style={S({ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", marginBottom: "12px" })}>
              <StatCard
                title="New Joiners"
                subtitle={
                  state.newBreakdown.primary !== null
                    ? `${state.newBreakdown.primary} primary · ${state.newBreakdown.spouse ?? 0} spouse · ${state.newBreakdown.partner ?? 0} partner`
                    : `Joined in ${range.label}`
                }
                badge="New" badgeColor="blue" count={state.counts.new} isLoading={loading.new} active={state.activeView === "new"} onClick={() => setView("new")} />
              {productType === "Academy" && (
                <StatCard title="Business Acquisitions" subtitle={`owners_circle in ${range.label}`} badge="Acquired" badgeColor="orange" count={state.counts.acquired} isLoading={loading.acquired} active={state.activeView === "acquired"} onClick={() => setView("acquired")} />
              )}
              <StatCard title="Churned" subtitle={`Became inactive in ${range.label}`} badge="Churned" badgeColor="red" count={state.counts.churned} isLoading={loading.churned} active={state.activeView === "churned"} onClick={() => setView("churned")} />
              <StatCard title="Expected Renewals" subtitle={`Expiring in ${range.label}`} badge="Expected" badgeColor="orange" count={state.counts.eligible} isLoading={loading.eligible} active={state.activeView === "eligible"} onClick={() => setView("eligible")} />
              <StatCard title="Actual Renewals" subtitle={`Renewed in ${range.label}`} badge="Actual" badgeColor="yellow" count={state.counts.renewal} isLoading={loading.renewal} active={state.activeView === "renewal"} onClick={() => setView("renewal")} />
              <StatCard title="Refunds" subtitle={`Refunded in ${range.label}`} badge="Refunded" badgeColor="rose" count={state.counts.refunded} isLoading={loading.refunded} active={state.activeView === "refunded"} onClick={() => setView("refunded")} />
              <StatCard title="Cancellations" subtitle={`Cancelled in ${range.label}`} badge="Cancelled" badgeColor="gray" count={state.counts.cancellations} isLoading={loading.cancellations} active={state.activeView === "cancellations"} onClick={() => setView("cancellations")} />
            </div>

            <div style={S({ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px", marginBottom: "24px" })}>
              <StatCard title="Renewal Rate" subtitle={`${state.counts.renewal ?? "—"} of ${state.counts.eligible ?? "—"} eligible · ${range.label}`} badge="Actual / (Eligible + Actual)" badgeColor="black" count={null} displayValue={renewalRate} isLoading={loading.renewal || loading.eligible} active={false} clickable={false} />
            </div>
          </>
        )}

        {/* ── Summary Report tab ─────────────────────────────────────────────── */}
        {state.tab === "report" && (
          <div>
            {/* Membership Snapshot */}
            <p style={S({ margin: "0 0 12px", fontSize: "12px", fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: "0.05em" })}>
              Membership Snapshot · All Time
            </p>
            <div style={S({ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", marginBottom: "28px" })}>
              <StatCard title="Current Active" subtitle="Total Active or Grace" badge="All" badgeColor="green" count={state.counts.current} isLoading={loading.current} active={false} clickable={false} />
              <StatCard title="Primary" subtitle="Primary members only" badge="Primary" badgeColor="cyan" count={state.counts.primary} isLoading={loading.primary} active={false} clickable={false} />
              <StatCard title="Spouse" subtitle="Secondary Spouse" badge="Spouse" badgeColor="purple" count={state.counts.spouse} isLoading={loading.spouse} active={false} clickable={false} />
              <StatCard title="Business Partner" subtitle="Secondary Business Partner" badge="Partner" badgeColor="indigo" count={state.counts.partner} isLoading={loading.partner} active={false} clickable={false} />
            </div>

            {/* Controls */}
            <div style={S({ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px", flexWrap: "wrap" })}>
              <div style={S({ display: "flex", gap: "4px" })}>
                {(["monthly", "quarterly", "yearly"] as ReportGranularity[]).map((g) => (
                  <button key={g} onClick={() => setReportGranularity(g)} style={S({
                    padding: "6px 14px", borderRadius: "6px", border: "1px solid #e6e6e3",
                    background: reportGranularity === g ? "#1a1a1a" : "#fff",
                    color: reportGranularity === g ? "#fff" : "#1a1a1a",
                    fontSize: "13px", fontWeight: 500, cursor: "pointer", textTransform: "capitalize",
                  })}>{g}</button>
                ))}
              </div>
              {reportGranularity !== "yearly" && (
                <select value={reportYear} onChange={(e) => setReportYear(Number(e.target.value))}
                  style={S({ padding: "6px 10px", border: "1px solid #e6e6e3", borderRadius: "6px", fontSize: "13px", background: "#fff", color: "#1a1a1a" })}>
                  {[0, 1, 2, 3].map((offset) => {
                    const y = new Date().getFullYear() - offset;
                    return <option key={y} value={y}>{y}</option>;
                  })}
                </select>
              )}
              <button onClick={exportReportCSV} disabled={reportLoading} style={S({
                marginLeft: "auto", background: "#fff", border: "1px solid #e6e6e3",
                borderRadius: "6px", padding: "7px 12px", fontSize: "13px", fontWeight: 500,
                cursor: reportLoading ? "not-allowed" : "pointer", color: "#1a1a1a",
              })}>
                Export CSV
              </button>
            </div>

            {/* Table */}
            <div style={S({ background: "#fff", border: "1px solid #e6e6e3", borderRadius: "12px", overflow: "hidden" })}>
              <div style={S({ overflowX: "auto" })}>
                <table style={S({ width: "100%", borderCollapse: "collapse", fontSize: "13px" })}>
                  <thead>
                    <tr style={S({ background: "#f7f7f5" })}>
                      {[
                        { label: "Period",              left: true  },
                        { label: "New Primary",         left: false },
                        { label: "New Secondary",       left: false },
                        { label: "Total New Members",   left: false },
                        { label: "Churned",             left: false },
                        { label: "Refunded",            left: false },
                        { label: "Actual Renewals",     left: false },
                        { label: "Eligible Renewals",   left: false },
                        { label: "Renewal Rate",        left: false },
                      ].map(({ label, left }) => (
                        <th key={label} style={S({ padding: "12px 20px", textAlign: left ? "left" : "right", fontWeight: 600, fontSize: "12px", color: "#666", borderBottom: "1px solid #e6e6e3", whiteSpace: "nowrap" })}>{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {reportRows.length === 0 && reportLoading && (
                      <tr><td colSpan={9} style={S({ padding: "32px", textAlign: "center", color: "#999" })}>Loading…</td></tr>
                    )}
                    {reportRows.map((row, i) => {
                      const renewalRate = row.actual !== null && row.eligible !== null && (row.eligible + row.actual) > 0
                        ? ((row.actual / (row.eligible + row.actual)) * 100).toFixed(1) + "%" : "—";
                      const loading = reportLoading && row.newPrimary === null;
                      const cell = (v: string | null, isLoading: boolean) => (
                        <td style={S({ padding: "11px 20px", textAlign: "right", color: isLoading ? "#ccc" : v === "—" || v === null ? "#999" : "#1a1a1a" })}>
                          {isLoading ? "···" : (v ?? "—")}
                        </td>
                      );
                      return (
                        <tr key={row.label} style={S({ borderBottom: "1px solid #f0f0ee", background: i % 2 === 0 ? "#fff" : "#fafaf9" })}>
                          <td style={S({ padding: "11px 20px", fontWeight: 500, color: "#1a1a1a" })}>{row.label}</td>
                          {cell(loading ? null : (row.newPrimary?.toLocaleString() ?? "—"), loading)}
                          {cell(loading ? null : (row.newSecondary?.toLocaleString() ?? "—"), loading)}
                          {cell(loading ? null : (row.newPrimary !== null && row.newSecondary !== null ? (row.newPrimary + row.newSecondary).toLocaleString() : "—"), loading)}
                          {cell(loading ? null : (row.churned?.toLocaleString() ?? "—"), loading)}
                          {cell(loading ? null : (row.refunded?.toLocaleString() ?? "—"), loading)}
                          {cell(loading ? null : (row.actual?.toLocaleString() ?? "—"), loading)}
                          {cell(loading ? null : (row.eligible?.toLocaleString() ?? "—"), loading)}
                          <td style={S({ padding: "11px 20px", textAlign: "right", fontWeight: 600, color: loading ? "#ccc" : renewalRate === "—" ? "#999" : "#1a1a1a" })}>{loading ? "···" : renewalRate}</td>
                        </tr>
                      );
                    })}
                    {/* Totals row */}
                    {!reportLoading && reportRows.length > 0 && reportGranularity !== "yearly" && (() => {
                      const totalNewPrimary   = reportRows.reduce((s, r) => s + (r.newPrimary ?? 0), 0);
                      const totalNewSecondary = reportRows.reduce((s, r) => s + (r.newSecondary ?? 0), 0);
                      const totalChurned  = reportRows.reduce((s, r) => s + (r.churned ?? 0), 0);
                      const totalRefunded = reportRows.reduce((s, r) => s + (r.refunded ?? 0), 0);
                      const totalActual   = reportRows.reduce((s, r) => s + (r.actual ?? 0), 0);
                      const totalEligible = reportRows.reduce((s, r) => s + (r.eligible ?? 0), 0);
                      const totalRenewalRate = totalEligible > 0 ? ((totalActual / totalEligible) * 100).toFixed(1) + "%" : "—";
                      const tf = (v: string) => <td style={S({ padding: "11px 20px", textAlign: "right", fontWeight: 700 })}>{v}</td>;
                      return (
                        <tr style={S({ borderTop: "2px solid #e6e6e3", background: "#f7f7f5" })}>
                          <td style={S({ padding: "11px 20px", fontWeight: 700, color: "#1a1a1a" })}>Total</td>
                          {tf(totalNewPrimary.toLocaleString())}
                          {tf(totalNewSecondary.toLocaleString())}
                          {tf((totalNewPrimary + totalNewSecondary).toLocaleString())}
                          {tf(totalChurned.toLocaleString())}
                          {tf(totalRefunded.toLocaleString())}
                          {tf(totalActual.toLocaleString())}
                          {tf(totalEligible.toLocaleString())}
                          {tf(totalRenewalRate)}
                        </tr>
                      );
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── Methodology tab ───────────────────────────────────────────────── */}
        {state.tab === "methodology" && (
          <div style={S({ maxWidth: "860px" })}>

            {/* ── Snapshot metrics ─────────────────────────────────────────────── */}
            <h2 style={S({ fontSize: "16px", fontWeight: 700, marginBottom: "12px", marginTop: 0 })}>Snapshot Metrics (All Time)</h2>
            <div style={S({ background: "#fff", border: "1px solid #e6e6e3", borderRadius: "12px", overflow: "hidden", marginBottom: "32px" })}>
              <table style={S({ width: "100%", borderCollapse: "collapse", fontSize: "13px" })}>
                <thead>
                  <tr style={S({ background: "#f7f7f5" })}>
                    <th style={S({ padding: "10px 16px", textAlign: "left", fontWeight: 600, fontSize: "12px", color: "#666", borderBottom: "1px solid #e6e6e3" })}>Metric</th>
                    <th style={S({ padding: "10px 16px", textAlign: "left", fontWeight: 600, fontSize: "12px", color: "#666", borderBottom: "1px solid #e6e6e3" })}>Definition</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Lifetime Members",       "All membership records ever created — counts every status (Active, Grace, Expired, Inactive – Delinquent, Inactive – Refunded)"],
                    ["Current Active — Total", "Members with status = Active OR Grace"],
                    ["Current Active — Primary",  "Active or Grace AND membership_type = Primary"],
                    ["Current Active — Spouse",   "Active or Grace AND membership_type = Secondary - Spouse"],
                    ["Current Active — Business Partner", "Active or Grace AND membership_type = Secondary - Business Partner"],
                    ["Business Acquisitions",  "Active or Grace AND owners_circle = true (Academy product type only)"],
                    ["Churned (All Time)",      "All members ever with status = Expired, Inactive – Delinquent, or Inactive – Refunded — no date filter"],
                    ["Actual Renewals (All Time)", "All members where actual_renewal_date has any value"],
                    ["Refunds (All Time)",      "All members where status = Inactive – Refunded — no date filter"],
                    ["Cancellations (All Time)","All members where access_revoked = true — no date filter"],
                  ].map(([col, def], i) => (
                    <tr key={col} style={S({ borderBottom: "1px solid #f0f0ee", background: i % 2 === 0 ? "#fff" : "#fafaf9" })}>
                      <td style={S({ padding: "10px 16px", fontWeight: 600, whiteSpace: "nowrap", color: "#1a1a1a", verticalAlign: "top" })}>{col}</td>
                      <td style={S({ padding: "10px 16px", color: "#444", lineHeight: 1.5 })}>{def}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ── Period metrics ────────────────────────────────────────────────── */}
            <h2 style={S({ fontSize: "16px", fontWeight: 700, marginBottom: "12px" })}>Period Metrics</h2>
            <div style={S({ background: "#fff", border: "1px solid #e6e6e3", borderRadius: "12px", overflow: "hidden", marginBottom: "32px" })}>
              <table style={S({ width: "100%", borderCollapse: "collapse", fontSize: "13px" })}>
                <thead>
                  <tr style={S({ background: "#f7f7f5" })}>
                    <th style={S({ padding: "10px 16px", textAlign: "left", fontWeight: 600, fontSize: "12px", color: "#666", borderBottom: "1px solid #e6e6e3" })}>Metric</th>
                    <th style={S({ padding: "10px 16px", textAlign: "left", fontWeight: 600, fontSize: "12px", color: "#666", borderBottom: "1px solid #e6e6e3" })}>Definition</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["New Joiners (Total)",          "Active or Grace AND start_date_v2 falls in the period"],
                    ["New Joiners — Primary",        "New Joiners AND membership_type = Primary"],
                    ["New Joiners — Spouse",         "New Joiners AND membership_type = Secondary - Spouse"],
                    ["New Joiners — Business Partner","New Joiners AND membership_type = Secondary - Business Partner"],
                    ["Business Acquisitions",        "Active or Grace AND owners_circle = true — scoped to the selected period (Academy only)"],
                    ["Churned",                      "status = Expired, Inactive – Delinquent, or Inactive – Refunded AND membership_inactive_date falls in the period"],
                    ["Expected Renewals",            "membership_type = Primary AND expected_renewal_date falls in the period (past periods: any status; current/future: Active or Grace only)"],
                    ["Actual Renewals",              "actual_renewal_date falls in the period"],
                    ["Refunds",                      "status = Inactive – Refunded AND expected_renewal_date falls in the period"],
                    ["Cancellations",                "access_revoked = true AND revocation_date falls in the period"],
                  ].map(([col, def], i) => (
                    <tr key={col} style={S({ borderBottom: "1px solid #f0f0ee", background: i % 2 === 0 ? "#fff" : "#fafaf9" })}>
                      <td style={S({ padding: "10px 16px", fontWeight: 600, whiteSpace: "nowrap", color: "#1a1a1a", verticalAlign: "top" })}>{col}</td>
                      <td style={S({ padding: "10px 16px", color: "#444", lineHeight: 1.5 })}>{def}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Eligible Renewals special note */}
            <div style={S({ marginBottom: "32px" })}>
              <h3 style={S({ fontSize: "14px", fontWeight: 700, margin: "0 0 8px" })}>Expected Renewals — Past vs. Current Periods</h3>
              <div style={S({ background: "#fff", border: "1px solid #e6e6e3", borderRadius: "10px", overflow: "hidden", marginBottom: "8px" })}>
                <table style={S({ width: "100%", borderCollapse: "collapse", fontSize: "13px" })}>
                  <thead>
                    <tr style={S({ background: "#f7f7f5" })}>
                      <th style={S({ padding: "9px 16px", textAlign: "left", fontWeight: 600, fontSize: "12px", color: "#666", borderBottom: "1px solid #e6e6e3" })}>Condition</th>
                      <th style={S({ padding: "9px 16px", textAlign: "left", fontWeight: 600, fontSize: "12px", color: "#666", borderBottom: "1px solid #e6e6e3" })}>Past Periods</th>
                      <th style={S({ padding: "9px 16px", textAlign: "left", fontWeight: 600, fontSize: "12px", color: "#666", borderBottom: "1px solid #e6e6e3" })}>Current & Future Periods</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["membership_type",       "Primary", "Primary"],
                      ["status",                "any (Active, Grace, Inactive, etc.)", "Active or Grace only"],
                      ["expected_renewal_date", "falls within the period", "falls within the period"],
                    ].map(([condition, past, future], i, arr) => (
                      <tr key={i} style={S({ borderBottom: i < arr.length - 1 ? "1px solid #f0f0ee" : "none" })}>
                        <td style={S({ padding: "9px 16px", color: "#666", whiteSpace: "nowrap" })}>{condition}</td>
                        <td style={S({ padding: "9px 16px", fontWeight: 500, fontFamily: "monospace", fontSize: "12px", color: "#1a1a1a" })}>{past}</td>
                        <td style={S({ padding: "9px 16px", fontWeight: 500, fontFamily: "monospace", fontSize: "12px", color: "#1a1a1a" })}>{future}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={S({ margin: "6px 0 0", fontSize: "12px", color: "#b45309", background: "#fef9c3", padding: "6px 10px", borderRadius: "6px" })}>
                For past periods, all primary members with an expected_renewal_date in range are counted regardless of current status — so lapsed members who were eligible are still included. For current and future periods only Active or Grace members are counted.
              </p>
            </div>

            {/* Summary Report columns */}
            <h2 style={S({ fontSize: "16px", fontWeight: 700, marginBottom: "12px" })}>Summary Report Columns</h2>
            <div style={S({ background: "#fff", border: "1px solid #e6e6e3", borderRadius: "12px", overflow: "hidden", marginBottom: "32px" })}>
              <table style={S({ width: "100%", borderCollapse: "collapse", fontSize: "13px" })}>
                <thead>
                  <tr style={S({ background: "#f7f7f5" })}>
                    <th style={S({ padding: "10px 16px", textAlign: "left", fontWeight: 600, fontSize: "12px", color: "#666", borderBottom: "1px solid #e6e6e3" })}>Column</th>
                    <th style={S({ padding: "10px 16px", textAlign: "left", fontWeight: 600, fontSize: "12px", color: "#666", borderBottom: "1px solid #e6e6e3" })}>Definition</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["New Primary",       "Members whose start_date_v2 falls in the period — membership_type = Primary"],
                    ["New Secondary",     "Spouse + Business Partner new joiners — combined total of both secondary membership types"],
                    ["Total New Members", "New Primary + New Secondary"],
                    ["Churned",           "status = Expired, Inactive – Delinquent, or Inactive – Refunded AND membership_inactive_date in the period"],
                    ["Refunded",          "status = Inactive – Refunded AND expected_renewal_date in the period"],
                    ["Actual Renewals",   "actual_renewal_date falls in the period"],
                    ["Eligible Renewals", "Primary members where expected_renewal_date falls in the period"],
                    ["Renewal Rate",      "Actual Renewals ÷ (Eligible + Actual Renewals) × 100"],
                  ].map(([col, def], i) => (
                    <tr key={col} style={S({ borderBottom: "1px solid #f0f0ee", background: i % 2 === 0 ? "#fff" : "#fafaf9" })}>
                      <td style={S({ padding: "10px 16px", fontWeight: 600, whiteSpace: "nowrap", color: "#1a1a1a", verticalAlign: "top" })}>{col}</td>
                      <td style={S({ padding: "10px 16px", color: "#444", lineHeight: 1.5 })}>{def}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Properties reference */}
            <h2 style={S({ fontSize: "16px", fontWeight: 700, marginBottom: "12px" })}>HubSpot Properties Reference</h2>
            <div style={S({ background: "#fff", border: "1px solid #e6e6e3", borderRadius: "12px", overflow: "hidden" })}>
              <table style={S({ width: "100%", borderCollapse: "collapse", fontSize: "13px" })}>
                <thead>
                  <tr style={S({ background: "#f7f7f5" })}>
                    <th style={S({ padding: "10px 16px", textAlign: "left", fontWeight: 600, fontSize: "12px", color: "#666", borderBottom: "1px solid #e6e6e3" })}>Property</th>
                    <th style={S({ padding: "10px 16px", textAlign: "left", fontWeight: 600, fontSize: "12px", color: "#666", borderBottom: "1px solid #e6e6e3" })}>Values / Meaning</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["status",                   "Active · Grace · Expired · Inactive – Delinquent · Inactive – Refunded"],
                    ["membership_type",           "Primary · Secondary - Spouse · Secondary - Business Partner"],
                    ["type",                      "Product line — Academy · Boardroom · AcqFound · SFN · Bundle (page-level filter)"],
                    ["start_date_v2",             "Date the membership started — used for New Joiners"],
                    ["actual_renewal_date",        "Date of the most recent actual renewal — used for Actual Renewals"],
                    ["expected_renewal_date",      "Date the membership is expected to renew — used for Expected Renewals"],
                    ["membership_inactive_date",   "Date the membership became inactive — used for Churned and Refunds"],
                    ["access_revoked",             "true if the member's access has been revoked — used for Cancellations"],
                    ["revocation_date",            "Date access was revoked — used to scope Cancellations to a period"],
                    ["owners_circle",              "true — member has acquired a business (Business Acquisitions metric; Academy only)"],
                    ["renewal_price",              "The member's renewal price — shown in Renewals and Refunds list views"],
                  ].map(([tag, meaning], i, arr) => (
                    <tr key={tag} style={S({ borderBottom: i < arr.length - 1 ? "1px solid #f0f0ee" : "none", background: i % 2 === 0 ? "#fff" : "#fafaf9" })}>
                      <td style={S({ padding: "10px 16px", fontWeight: 500, fontFamily: "monospace", fontSize: "12px", color: "#1a1a1a", whiteSpace: "nowrap" })}>{tag}</td>
                      <td style={S({ padding: "10px 16px", color: "#444", lineHeight: 1.5 })}>{meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </div>
        )}

        {/* ── Eligible Renewals breakdown tab ──────────────────────────────────── */}
        {state.tab === "renewals" && (
          <div>
            <PeriodBar state={state} customTempStart={customTempStart} customTempEnd={customTempEnd}
              setCustomTempStart={setCustomTempStart} setCustomTempEnd={setCustomTempEnd}
              onSetPeriod={setPeriod} onApplyCustom={applyCustom}
              pastMonths={pastMonths} nextMonths={nextMonths}
              onSetSpecificMonth={(v) => setState((s) => ({ ...s, period: "specific", specificMonth: v }))} />

            {/* Summary stats */}
            {(() => {
              const knownPrices = eligBreakdownContacts
                .map((c) => parseFloat((c.properties.community_renewal_price ?? "").replace(/[^0-9.]/g, "")))
                .filter((n) => !isNaN(n));
              const totalAtStake = knownPrices.reduce((s, n) => s + n, 0);
              const avgPerMember = knownPrices.length > 0 ? totalAtStake / knownPrices.length : null;
              const stillLoading = eligBreakdownLoading && eligBreakdownTotal === null;
              const loadingMore  = eligBreakdownLoading && eligBreakdownTotal !== null;
              return (
                <div style={S({ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px", marginBottom: "24px" })}>
                  <StatCard
                    title="Eligible for Renewal"
                    subtitle={range.label}
                    badge="In period"
                    badgeColor="orange"
                    count={eligBreakdownTotal}
                    isLoading={stillLoading}
                    active={false}
                    clickable={false}
                  />
                  <StatCard
                    title="Total at Stake"
                    subtitle={loadingMore ? `Loading… ${eligBreakdownContacts.length} of ${eligBreakdownTotal}` : "known amounts only"}
                    badge="Revenue"
                    badgeColor="green"
                    count={null}
                    displayValue={stillLoading ? undefined : loadingMore ? "···" : "$" + totalAtStake.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    isLoading={stillLoading}
                    active={false}
                    clickable={false}
                  />
                  <StatCard
                    title="Avg per Member"
                    subtitle="among members with amount set"
                    badge="Average"
                    badgeColor="blue"
                    count={null}
                    displayValue={stillLoading ? undefined : loadingMore ? "···" : avgPerMember !== null ? "$" + Math.round(avgPerMember).toLocaleString("en-US") : "—"}
                    isLoading={stillLoading}
                    active={false}
                    clickable={false}
                  />
                </div>
              );
            })()}

            {/* Breakdown table */}
            {(() => {
              // Build price breakdown from loaded contacts.
              // Normalize to a canonical numeric key so "5000" and "5000.00"
              // don't create two separate rows.
              const counts = new Map<string, number>();
              for (const c of eligBreakdownContacts) {
                const raw = (c.properties.community_renewal_price ?? "").trim();
                let key: string;
                if (raw === "") {
                  key = "Not set";
                } else {
                  const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
                  key = isNaN(n) ? raw : String(n);
                }
                counts.set(key, (counts.get(key) ?? 0) + 1);
              }

              // Sort: numeric prices descending, "Not set" last
              const rows = Array.from(counts.entries()).sort((a, b) => {
                if (a[0] === "Not set") return 1;
                if (b[0] === "Not set") return -1;
                const na = parseFloat(a[0].replace(/[^0-9.]/g, ""));
                const nb = parseFloat(b[0].replace(/[^0-9.]/g, ""));
                if (!isNaN(na) && !isNaN(nb)) return nb - na;
                return a[0].localeCompare(b[0]);
              });

              const total = eligBreakdownContacts.length;

              function exportBreakdownCSV() {
                const header = ["Renewal Price", "Count", "% of Total"].map(csvEscape).join(",");
                const lines = rows.map(([price, count]) =>
                  [price, String(count), total > 0 ? ((count / total) * 100).toFixed(1) + "%" : "—"].map(csvEscape).join(",")
                );
                const csv = [header, ...lines].join("\n");
                const blob = new Blob([csv], { type: "text/csv" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `eligible_renewals_by_price_${range.label.replace(/\s+/g, "_")}_${todayISO()}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              }

              return (
                <div style={S({ background: "#fff", border: "1px solid #e6e6e3", borderRadius: "12px", overflow: "hidden" })}>
                  <div style={S({ padding: "16px 20px", borderBottom: "1px solid #e6e6e3", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" })}>
                    <div>
                      <span style={S({ fontSize: "14px", fontWeight: 600 })}>Breakdown by Renewal Price</span>
                      {total > 0 && (
                        <span style={S({ fontSize: "13px", color: "#666", marginLeft: "8px" })}>
                          {total.toLocaleString()} contacts{eligBreakdownLoading ? " (loading more…)" : ""}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={exportBreakdownCSV}
                      disabled={eligBreakdownLoading || rows.length === 0}
                      style={S({ background: "#fff", border: "1px solid #e6e6e3", borderRadius: "6px", padding: "7px 12px", fontSize: "13px", fontWeight: 500, cursor: (eligBreakdownLoading || rows.length === 0) ? "not-allowed" : "pointer", color: "#1a1a1a" })}
                    >
                      Export CSV
                    </button>
                  </div>
                  <div style={S({ overflowX: "auto" })}>
                    <table style={S({ width: "100%", borderCollapse: "collapse", fontSize: "13px" })}>
                      <thead>
                        <tr style={S({ background: "#f7f7f5" })}>
                          <th style={S({ padding: "12px 20px", textAlign: "left", fontWeight: 600, fontSize: "12px", color: "#666", borderBottom: "1px solid #e6e6e3" })}>Renewal Price</th>
                          <th style={S({ padding: "12px 20px", textAlign: "right", fontWeight: 600, fontSize: "12px", color: "#666", borderBottom: "1px solid #e6e6e3" })}>Count</th>
                          <th style={S({ padding: "12px 20px", textAlign: "right", fontWeight: 600, fontSize: "12px", color: "#666", borderBottom: "1px solid #e6e6e3" })}>% of Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.length === 0 && !eligBreakdownLoading && (
                          <tr><td colSpan={3} style={S({ padding: "32px", textAlign: "center", color: "#999" })}>No eligible renewals for this period</td></tr>
                        )}
                        {rows.length === 0 && eligBreakdownLoading && (
                          <tr><td colSpan={3} style={S({ padding: "32px", textAlign: "center", color: "#999" })}>Loading…</td></tr>
                        )}
                        {rows.map(([price, count], i) => {
                          const pct = total > 0 ? ((count / total) * 100).toFixed(1) + "%" : "—";
                          const isNotSet = price === "Not set";
                          return (
                            <tr key={price} style={S({ borderBottom: "1px solid #f0f0ee", background: i % 2 === 0 ? "#fff" : "#fafaf9" })}>
                              <td style={S({ padding: "11px 20px", fontWeight: 600, color: isNotSet ? "#999" : "#1a1a1a", fontStyle: isNotSet ? "italic" : "normal" })}>
                                {isNotSet ? "Not set" : `$${parseFloat(price).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`}
                              </td>
                              <td style={S({ padding: "11px 20px", textAlign: "right", color: "#1a1a1a" })}>{count.toLocaleString()}</td>
                              <td style={S({ padding: "11px 20px", textAlign: "right", color: "#666" })}>{pct}</td>
                            </tr>
                          );
                        })}
                        {/* Totals row */}
                        {rows.length > 0 && !eligBreakdownLoading && (
                          <tr style={S({ borderTop: "2px solid #e6e6e3", background: "#f7f7f5" })}>
                            <td style={S({ padding: "11px 20px", fontWeight: 700 })}>Total</td>
                            <td style={S({ padding: "11px 20px", textAlign: "right", fontWeight: 700 })}>{total.toLocaleString()}</td>
                            <td style={S({ padding: "11px 20px", textAlign: "right", fontWeight: 700 })}>100%</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}

            {/* Weekly breakdown */}
            {(() => {
              const weeks = getWeeksInRange(range.start, range.end);
              // bucket eligible by expected_renewal_date week
              const eligByWeek = new Map<string, number>();
              for (const c of eligBreakdownContacts) {
                const ws = getWeekStartStr(c.properties.expected_renewal_date);
                if (ws) eligByWeek.set(ws, (eligByWeek.get(ws) ?? 0) + 1);
              }
              // bucket actuals by actual_renewal_date week
              const actualByWeek = new Map<string, number>();
              for (const c of eligActualContacts) {
                const ws = getWeekStartStr(c.properties.actual_renewal_date);
                if (ws) actualByWeek.set(ws, (actualByWeek.get(ws) ?? 0) + 1);
              }
              const isLoading = eligBreakdownLoading || eligActualLoading;
              const totalElig = weeks.reduce((s, w) => s + (eligByWeek.get(w.ws) ?? 0), 0);
              const totalActual = weeks.reduce((s, w) => s + (actualByWeek.get(w.ws) ?? 0), 0);

              return (
                <div style={S({ background: "#fff", border: "1px solid #e6e6e3", borderRadius: "12px", overflow: "hidden", marginTop: "16px" })}>
                  <div style={S({ padding: "16px 20px", borderBottom: "1px solid #e6e6e3", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" })}>
                    <span style={S({ fontSize: "14px", fontWeight: 600 })}>Weekly Breakdown</span>
                    {isLoading && <span style={S({ fontSize: "12px", color: "#999" })}>Loading…</span>}
                  </div>
                  <div style={S({ overflowX: "auto" })}>
                    <table style={S({ width: "100%", borderCollapse: "collapse", fontSize: "13px" })}>
                      <thead>
                        <tr style={S({ background: "#f7f7f5" })}>
                          <th style={S({ padding: "11px 20px", textAlign: "left",  fontWeight: 600, fontSize: "12px", color: "#666", borderBottom: "1px solid #e6e6e3" })}>Week</th>
                          <th style={S({ padding: "11px 20px", textAlign: "right", fontWeight: 600, fontSize: "12px", color: "#666", borderBottom: "1px solid #e6e6e3" })}>Eligible Expiring</th>
                          <th style={S({ padding: "11px 20px", textAlign: "right", fontWeight: 600, fontSize: "12px", color: "#666", borderBottom: "1px solid #e6e6e3" })}>Actual Renewals</th>
                          <th style={S({ padding: "11px 20px", textAlign: "right", fontWeight: 600, fontSize: "12px", color: "#666", borderBottom: "1px solid #e6e6e3" })}>Renewal Rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {weeks.length === 0 && (
                          <tr><td colSpan={4} style={S({ padding: "32px", textAlign: "center", color: "#999" })}>No weeks in this period</td></tr>
                        )}
                        {weeks.map(({ ws, label }, i) => {
                          const elig = eligByWeek.get(ws) ?? 0;
                          const actual = actualByWeek.get(ws) ?? 0;
                          const rate = (elig + actual) > 0 ? ((actual / (elig + actual)) * 100).toFixed(1) + "%" : "—";
                          const hasData = elig > 0 || actual > 0;
                          return (
                            <tr key={ws} style={S({ borderBottom: "1px solid #f0f0ee", background: i % 2 === 0 ? "#fff" : "#fafaf9", opacity: hasData ? 1 : 0.45 })}>
                              <td style={S({ padding: "11px 20px", color: "#1a1a1a", whiteSpace: "nowrap" })}>{label}</td>
                              <td style={S({ padding: "11px 20px", textAlign: "right", color: "#1a1a1a" })}>{elig > 0 ? elig.toLocaleString() : "—"}</td>
                              <td style={S({ padding: "11px 20px", textAlign: "right", color: actual > 0 ? "#16a34a" : "#1a1a1a" })}>{actual > 0 ? actual.toLocaleString() : "—"}</td>
                              <td style={S({ padding: "11px 20px", textAlign: "right", color: "#666" })}>{rate}</td>
                            </tr>
                          );
                        })}
                        {weeks.length > 0 && !isLoading && (
                          <tr style={S({ borderTop: "2px solid #e6e6e3", background: "#f7f7f5" })}>
                            <td style={S({ padding: "11px 20px", fontWeight: 700 })}>Total</td>
                            <td style={S({ padding: "11px 20px", textAlign: "right", fontWeight: 700 })}>{totalElig > 0 ? totalElig.toLocaleString() : "—"}</td>
                            <td style={S({ padding: "11px 20px", textAlign: "right", fontWeight: 700, color: totalActual > 0 ? "#16a34a" : "#1a1a1a" })}>{totalActual > 0 ? totalActual.toLocaleString() : "—"}</td>
                            <td style={S({ padding: "11px 20px", textAlign: "right", fontWeight: 700, color: "#666" })}>
                              {(totalElig + totalActual) > 0 ? ((totalActual / (totalElig + totalActual)) * 100).toFixed(1) + "%" : "—"}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* Churned data note */}
        {state.activeView === "churned" && (
          <div style={S({ background: "#fef9c3", border: "1px solid #fde68a", borderRadius: "8px", padding: "12px 16px", marginBottom: "16px", fontSize: "13px", color: "#854d0e" })}>
            <strong>Note:</strong> Churned members are those whose membership_inactive_date falls within the selected period and whose status is Expired, Inactive – Delinquent, or Inactive – Refunded.
          </div>
        )}

        {/* Contact table — Members tab only */}
        {state.tab === "members" && <div style={S({ background: "#fff", border: "1px solid #e6e6e3", borderRadius: "12px", overflow: "hidden" })}>
          <div style={S({ padding: "16px 20px", borderBottom: "1px solid #e6e6e3", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" })}>
            <div>
              <span style={S({ fontSize: "14px", fontWeight: 600 })}>{VIEW_TITLES[state.activeView]}</span>
              {activeTotal !== null && (
                <span style={S({ fontSize: "13px", color: "#666", marginLeft: "8px" })}>
                  {sortedRows.length.toLocaleString()}{activeRows.length < activeTotal ? ` of ${activeTotal.toLocaleString()} loaded` : ` total`}
                  {excludeCT && sortedRows.length < activeRows.length ? ` · ${activeRows.length - sortedRows.length} CT excluded` : ""}
                </span>
              )}
            </div>
            <button onClick={exportViewCSV} style={S({ background: "#fff", border: "1px solid #e6e6e3", borderRadius: "6px", padding: "7px 12px", fontSize: "13px", fontWeight: 500, cursor: "pointer", color: "#1a1a1a" })}>
              Export this view (CSV)
            </button>
          </div>

          <div style={S({ overflowX: "auto" })}>
            <table style={S({ width: "100%", borderCollapse: "collapse", fontSize: "13px" })}>
              <thead>
                <tr style={S({ background: "#f7f7f5" })}>
                  {cols.map((c) => {
                    const active = sortCol === c.label;
                    const arrow = active ? (sortDir === "asc" ? " ↑" : " ↓") : " ↕";
                    return (
                      <th key={c.label}
                        onClick={() => handleSortClick(c.label)}
                        style={S({ padding: "10px 16px", textAlign: "left", fontWeight: 600, fontSize: "12px", color: active ? "#1a1a1a" : "#666", borderBottom: "1px solid #e6e6e3", whiteSpace: "nowrap", cursor: "pointer", userSelect: "none" })}>
                        {c.label}
                        <span style={S({ opacity: active ? 1 : 0.35, fontSize: "10px", marginLeft: "2px" })}>{arrow}</span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedRows.length === 0 && !loading[state.activeView] && (
                  <tr><td colSpan={cols.length} style={S({ padding: "32px 16px", textAlign: "center", color: "#666" })}>No results for this period</td></tr>
                )}
                {sortedRows.map((contact, i) => (
                  <tr key={contact.id} style={S({ borderBottom: "1px solid #f0f0ee", background: i % 2 === 0 ? "#fff" : "#fafaf9" })}>
                    {cols.map((c, ci) => (
                      <td key={c.label} style={S({ padding: "10px 16px", verticalAlign: "top", maxWidth: ci === cols.length - 1 ? "280px" : undefined, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: ci === cols.length - 1 ? "normal" : "nowrap" })}>
                        {ci === 0 ? (
                          <a href={hubspotUrl(contact.id)} target="_blank" rel="noopener noreferrer" style={S({ color: "#2563eb", textDecoration: "none", fontWeight: 500 })}>
                            {c.value(contact)}
                          </a>
                        ) : (
                          c.value(contact)
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {activeTotal !== null && activeRows.length < activeTotal && (
            <div style={S({ padding: "16px 20px", borderTop: "1px solid #e6e6e3", textAlign: "center" })}>
              <button onClick={loadMore} disabled={state.loadingMore} style={S({ background: "#fff", border: "1px solid #e6e6e3", borderRadius: "8px", padding: "10px 24px", fontSize: "13px", fontWeight: 600, cursor: state.loadingMore ? "not-allowed" : "pointer", color: "#1a1a1a" })}>
                {state.loadingMore ? "Loading…" : `Load more (${(activeTotal - activeRows.length).toLocaleString()} remaining)`}
              </button>
            </div>
          )}
        </div>}
      </div>
    </div>
  );
}
