"use client";

import { useState, useEffect, useCallback } from "react";
import {
  currentAllFilters,
  primaryBaseFilters,
  currentSecondaryFilters,
  newJoinersFilters,
  newJoinersPrimaryFilters,
  newJoinersSecondaryFilters,
  churnedFilters,
  renewalActualFilters,
  eligibleRenewalFilters,
  eligibleRenewalActiveFilters,
  refundedFilters,
  HubSpotFilter,
  CONTACT_PROPERTIES,
} from "@/lib/filters";
import {
  getPeriodRange,
  getSpecificMonthOptions,
  getNextMonthOptions,
  currentMonthValue,
  PeriodState,
  PeriodType,
} from "@/lib/period";

const PORTAL_ID = "23982969";

export type ViewKey =
  | "current"
  | "primary"
  | "secondary"
  | "new"
  | "churned"
  | "renewal"
  | "eligible"
  | "refunded";

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
  tab: "report" | "members" | "methodology";
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
  newBreakdown: { primary: number | null; secondary: number | null };
}

type LoadingMap = Record<ViewKey, boolean>;

const cache = new Map<string, { data: HubSpotResult; ts: number }>();
const CACHE_TTL = 30_000;

// ── localStorage cache for past report periods ────────────────────────────────
// Past months never change, so we store them indefinitely across sessions.
type StoredRowCounts = Pick<ReportRow, "newPrimary" | "newSecondary" | "churned" | "refunded" | "actual" | "eligible">;

function lsKey(start: string, end: string): string {
  return `academy_report_${start}_${end}`;
}

function getStoredPeriod(start: string, end: string): StoredRowCounts | null {
  try {
    const raw = localStorage.getItem(lsKey(start, end));
    if (!raw) return null;
    return JSON.parse(raw) as StoredRowCounts;
  } catch {
    return null;
  }
}

function storePeriod(start: string, end: string, data: StoredRowCounts): void {
  try {
    localStorage.setItem(lsKey(start, end), JSON.stringify(data));
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

  const res = await fetch("/api/hubspot-search", {
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
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtName(c: Contact): string {
  const f = c.properties.firstname ?? "";
  const l = c.properties.lastname ?? "";
  return [f, l].filter(Boolean).join(" ") || (c.properties.email ?? c.id);
}

function hubspotUrl(id: string): string {
  return `https://app.hubspot.com/contacts/${PORTAL_ID}/record/0-1/${id}`;
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

const ALL_VIEWS: ViewKey[] = ["current", "primary", "secondary", "new", "churned", "renewal", "eligible", "refunded"];

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

function viewFilters(view: ViewKey, start: string, end: string): HubSpotFilter[] {
  const today = new Date().toISOString().slice(0, 10);
  const isPast = end < today;
  switch (view) {
    case "current":   return currentAllFilters();
    case "primary":   return primaryBaseFilters();
    case "secondary": return currentSecondaryFilters();
    case "new":       return newJoinersFilters(start, end);
    case "churned":   return churnedFilters(start, end);
    case "renewal":   return renewalActualFilters(start, end);
    case "eligible":  return isPast ? eligibleRenewalFilters(start, end) : eligibleRenewalActiveFilters(start, end);
    case "refunded":  return refundedFilters(start, end);
  }
}

function tableColumns(view: ViewKey): { label: string; value: (c: Contact) => string }[] {
  if (view === "churned") {
    return [
      { label: "Name",        value: fmtName },
      { label: "Email",       value: (c) => c.properties.email ?? "—" },
      { label: "Date Joined", value: (c) => fmtDate(c.properties.date_joined) },
      { label: "Revoked On",  value: (c) => fmtDate(c.properties.community_access_revoked_date) },
      { label: "Tags",        value: (c) => c.properties.all_contact_tags ?? "—" },
    ];
  }
  if (view === "refunded") {
    return [
      { label: "Name",        value: fmtName },
      { label: "Email",       value: (c) => c.properties.email ?? "—" },
      { label: "Date Joined", value: (c) => fmtDate(c.properties.date_joined) },
      { label: "Expiration",  value: (c) => fmtDate(c.properties.expiration_date) },
      { label: "Tags",        value: (c) => c.properties.all_contact_tags ?? "—" },
    ];
  }
  return [
    { label: "Name",           value: fmtName },
    { label: "Email",          value: (c) => c.properties.email ?? "—" },
    { label: "Date Joined",    value: (c) => fmtDate(c.properties.date_joined) },
    { label: "Latest Renewal", value: (c) => fmtDate(c.properties.latest_renewal_date) },
    { label: "Expiration",     value: (c) => fmtDate(c.properties.expiration_date) },
  ];
}

const VIEW_TITLES: Record<ViewKey, string> = {
  current:   "Current Members (All)",
  primary:   "Current Primary Members",
  secondary: "Current Secondary Members",
  new:       "New Joiners",
  churned:   "Churned Members",
  renewal:   "Renewals — Actual",
  eligible:  "Eligible Renewals",
  refunded:  "Refunded Members",
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
    activeView: "new",
    counts: makeNullRecord(null),
    rows: makeNullRecord([]) as Record<ViewKey, Contact[]>,
    totals: makeNullRecord(null),
    offsets: makeNullRecord(undefined) as Record<ViewKey, string | undefined>,
    loadingMore: false,
    newBreakdown: { primary: null, secondary: null },
  });

  const [loading, setLoading] = useState<LoadingMap>(makeNullRecord(true) as LoadingMap);
  const [customTempStart, setCustomTempStart] = useState(d30start);
  const [customTempEnd, setCustomTempEnd] = useState(d30end);
  const [downloadProgress, setDownloadProgress] = useState<string | null>(null);

  // ── Summary Report state ──────────────────────────────────────────────────
  const [reportGranularity, setReportGranularity] = useState<ReportGranularity>("monthly");
  const [reportYear, setReportYear] = useState(new Date().getFullYear());
  const [reportRows, setReportRows] = useState<ReportRow[]>([]);
  const [reportLoading, setReportLoading] = useState(false);

  const periodState: PeriodState = {
    period: state.period,
    customStart: state.customStart,
    customEnd: state.customEnd,
    specificMonth: state.specificMonth,
  };
  const range = getPeriodRange(periodState);

  const renewalRate =
    state.counts.eligible !== null && state.counts.renewal !== null && state.counts.eligible > 0
      ? ((state.counts.renewal / state.counts.eligible) * 100).toFixed(1) + "%"
      : "—";

  const loadSnapshotViews = useCallback(async () => {
    setLoading((l) => ({ ...l, current: true, primary: true, secondary: true }));
    const [all, prim, sec] = await Promise.allSettled([
      searchContacts(currentAllFilters()),
      searchContacts(primaryBaseFilters()),
      searchContacts(currentSecondaryFilters()),
    ]);
    setState((s) => {
      const snap = (r: PromiseSettledResult<HubSpotResult>) =>
        r.status === "fulfilled" ? r.value : null;
      return {
        ...s,
        counts: { ...s.counts, current: snap(all)?.total ?? null, primary: snap(prim)?.total ?? null, secondary: snap(sec)?.total ?? null },
        rows:   { ...s.rows,   current: snap(all)?.results ?? [], primary: snap(prim)?.results ?? [], secondary: snap(sec)?.results ?? [] },
        totals: { ...s.totals, current: snap(all)?.total ?? null, primary: snap(prim)?.total ?? null, secondary: snap(sec)?.total ?? null },
        offsets: { ...s.offsets, current: snap(all)?.paging?.next?.after, primary: snap(prim)?.paging?.next?.after, secondary: snap(sec)?.paging?.next?.after },
      };
    });
    setLoading((l) => ({ ...l, current: false, primary: false, secondary: false }));
  }, []);

  const loadPeriodViews = useCallback(async (start: string, end: string) => {
    setLoading((l) => ({ ...l, new: true, churned: true, renewal: true, eligible: true, refunded: true }));
    setState((s) => ({
      ...s,
      counts:  { ...s.counts,  new: null, churned: null, renewal: null, eligible: null, refunded: null },
      rows:    { ...s.rows,    new: [],   churned: [],   renewal: [],   eligible: [],   refunded: [] },
      totals:  { ...s.totals,  new: null, churned: null, renewal: null, eligible: null, refunded: null },
      offsets: { ...s.offsets, new: undefined, churned: undefined, renewal: undefined, eligible: undefined, refunded: undefined },
      newBreakdown: { primary: null, secondary: null },
    }));

    const today = new Date().toISOString().slice(0, 10);
    const isPast = end < today;
    const eligFilters = isPast ? eligibleRenewalFilters(start, end) : eligibleRenewalActiveFilters(start, end);
    const [newJ, churn, renew, elig, refund, newPrim, newSec] = await Promise.allSettled([
      searchContacts(newJoinersFilters(start, end)),
      searchContacts(churnedFilters(start, end)),
      searchContacts(renewalActualFilters(start, end)),
      searchContacts(eligFilters),
      searchContacts(refundedFilters(start, end)),
      searchContacts(newJoinersPrimaryFilters(start, end)),
      searchContacts(newJoinersSecondaryFilters(start, end)),
    ]);

    setState((s) => {
      const v = (r: PromiseSettledResult<HubSpotResult>) => r.status === "fulfilled" ? r.value : null;
      return {
        ...s,
        counts:  { ...s.counts,  new: v(newJ)?.total ?? null, churned: v(churn)?.total ?? null, renewal: v(renew)?.total ?? null, eligible: v(elig)?.total ?? null, refunded: v(refund)?.total ?? null },
        rows:    { ...s.rows,    new: v(newJ)?.results ?? [], churned: v(churn)?.results ?? [], renewal: v(renew)?.results ?? [], eligible: v(elig)?.results ?? [], refunded: v(refund)?.results ?? [] },
        totals:  { ...s.totals,  new: v(newJ)?.total ?? null, churned: v(churn)?.total ?? null, renewal: v(renew)?.total ?? null, eligible: v(elig)?.total ?? null, refunded: v(refund)?.total ?? null },
        offsets: { ...s.offsets, new: v(newJ)?.paging?.next?.after, churned: v(churn)?.paging?.next?.after, renewal: v(renew)?.paging?.next?.after, eligible: v(elig)?.paging?.next?.after, refunded: v(refund)?.paging?.next?.after },
        newBreakdown: { primary: v(newPrim)?.total ?? null, secondary: v(newSec)?.total ?? null },
      };
    });
    setLoading((l) => ({ ...l, new: false, churned: false, renewal: false, eligible: false, refunded: false }));
  }, []);

  const loadReport = useCallback(async (granularity: ReportGranularity, year: number) => {
    const periods = generateReportPeriods(granularity, year);
    setReportRows(periods.map((p) => ({ ...p, ...EMPTY_ROW_COUNTS })));
    setReportLoading(true);

    const todayISO2 = new Date().toISOString().slice(0, 10);

    // For past periods: serve from localStorage instantly, skip the API call.
    // For current/future periods: always fetch from API.
    // Past periods that aren't cached yet are fetched and then stored for future visits.
    for (let i = 0; i < periods.length; i++) {
      const p = periods[i];
      const isPast = p.end < todayISO2;

      if (isPast) {
        const stored = getStoredPeriod(p.start, p.end);
        if (stored) {
          setReportRows((rows) => rows.map((row, j) => j !== i ? row : { ...row, ...stored }));
          continue;
        }
      }

      const eligFilters = isPast ? eligibleRenewalFilters(p.start, p.end) : eligibleRenewalActiveFilters(p.start, p.end);
      try {
        const [newPrim, newSec, churn, refund, actual, eligible] = await Promise.all([
          searchContacts(newJoinersPrimaryFilters(p.start, p.end)),
          searchContacts(newJoinersSecondaryFilters(p.start, p.end)),
          searchContacts(churnedFilters(p.start, p.end)),
          searchContacts(refundedFilters(p.start, p.end)),
          searchContacts(renewalActualFilters(p.start, p.end)),
          searchContacts(eligFilters),
        ]);
        const counts: StoredRowCounts = {
          newPrimary:   newPrim.total   ?? newPrim.results.length,
          newSecondary: newSec.total    ?? newSec.results.length,
          churned:      churn.total     ?? churn.results.length,
          refunded:     refund.total    ?? refund.results.length,
          actual:       actual.total    ?? actual.results.length,
          eligible:     eligible.total  ?? eligible.results.length,
        };
        setReportRows((rows) => rows.map((row, j) => j !== i ? row : { ...row, ...counts }));
        if (isPast) storePeriod(p.start, p.end, counts);
      } catch {
        // leave this row as EMPTY_ROW_COUNTS
      }
    }

    setReportLoading(false);
  }, []);

  useEffect(() => { loadSnapshotViews(); }, [loadSnapshotViews]);
  useEffect(() => { loadPeriodViews(range.start, range.end); }, // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.period, state.customStart, state.customEnd, state.specificMonth]);
  useEffect(() => {
    if (state.tab === "report") loadReport(reportGranularity, reportYear);
  }, [state.tab, reportGranularity, reportYear, loadReport]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadMore() {
    const view = state.activeView;
    const after = state.offsets[view];
    if (!after || state.loadingMore) return;
    setState((s) => ({ ...s, loadingMore: true }));
    const data = await searchContacts(viewFilters(view, range.start, range.end), after).catch(() => null);
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
      const renewalRate = r.actual !== null && r.eligible !== null && r.eligible > 0
        ? ((r.actual / r.eligible) * 100).toFixed(1) + "%" : "—";
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
    a.href = url; a.download = `academy_summary_report_${reportGranularity}_${reportYear}_${todayISO()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  function setPeriod(p: PeriodType) { setState((s) => ({ ...s, period: p })); }
  function applyCustom() { setState((s) => ({ ...s, period: "custom", customStart: customTempStart, customEnd: customTempEnd })); }
  function setView(v: ViewKey) { setState((s) => ({ ...s, activeView: v })); }

  function exportViewCSV() {
    const rows = state.rows[state.activeView];
    const cols = tableColumns(state.activeView);
    const header = cols.map((c) => csvEscape(c.label)).join(",");
    const lines = rows.map((c) => cols.map((col) => csvEscape(col.value(c))).join(","));
    const csv = [header, ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `academy_${state.activeView}_${todayISO()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  async function downloadFullReport() {
    setDownloadProgress("Starting full report…");
    const views: { key: ViewKey; title: string; snapshot: boolean }[] = [
      { key: "current",   title: "Current Members (All)", snapshot: true },
      { key: "primary",   title: "Current Primary",       snapshot: true },
      { key: "secondary", title: "Current Secondary",     snapshot: true },
      { key: "new",       title: "New Joiners",           snapshot: false },
      { key: "churned",   title: "Churned",               snapshot: false },
      { key: "renewal",   title: "Renewals (Actual)",     snapshot: false },
      { key: "eligible",  title: "Eligible Renewals",     snapshot: false },
      { key: "refunded",  title: "Refunded",              snapshot: false },
    ];
    const headers = ["Segment","Period / Month","HubSpot ID","HubSpot URL","First Name","Last Name","Email","Date Joined","Latest Renewal","Community Expiration","Community Access Revoked","Revoked On","All Contact Tags"];
    const allLines: string[] = [headers.map(csvEscape).join(",")];

    for (const v of views) {
      const filters = viewFilters(v.key, range.start, range.end);
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
            c.properties.firstname ?? "", c.properties.lastname ?? "", c.properties.email ?? "",
            c.properties.date_joined ?? "", c.properties.latest_renewal_date ?? "", c.properties.expiration_date ?? "",
            c.properties.community_access_revoked ?? "", c.properties.community_access_revoked_date ?? "",
            c.properties.all_contact_tags ?? "",
          ].map(csvEscape).join(","));
        }
      } while (after);
    }

    setDownloadProgress("Generating file…");
    const csv = allLines.join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `academy_full_report_${range.label.replace(/\s+/g, "_")}_${todayISO()}.csv`; a.click();
    URL.revokeObjectURL(url);
    setDownloadProgress(null);
  }

  const pastMonths = getSpecificMonthOptions();
  const nextMonths = getNextMonthOptions();
  const activeRows = state.rows[state.activeView];
  const activeTotal = state.totals[state.activeView];
  const cols = tableColumns(state.activeView);

  const S = (style: React.CSSProperties) => style;

  return (
    <div style={S({ minHeight: "100vh", background: "#f7f7f5", fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', color: "#1a1a1a" })}>
      {/* Topbar */}
      <div style={S({ background: "#fff", borderBottom: "1px solid #e6e6e3", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px", position: "sticky", top: 0, zIndex: 10 })}>
        <div>
          <h1 style={S({ margin: 0, fontSize: "18px", fontWeight: 700 })}>Contrarian Academy Members</h1>
          <p style={S({ margin: "2px 0 0", fontSize: "13px", color: "#666" })}>
            {state.counts.current !== null ? `${state.counts.current.toLocaleString()} current members` : "Loading…"}
            {state.counts.primary !== null ? ` · ${state.counts.primary.toLocaleString()} primary` : ""}
            {state.counts.secondary !== null ? ` · ${state.counts.secondary.toLocaleString()} secondary` : ""}
          </p>
        </div>
        <div style={S({ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" })}>
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
          ] as const).map(({ key, label }) => (
            <button key={key} onClick={() => setState((s) => ({ ...s, tab: key, activeView: "primary" }))}
              style={S({ padding: "8px 20px", borderRadius: "8px", border: "1px solid #e6e6e3", background: state.tab === key ? "#1a1a1a" : "#fff", color: state.tab === key ? "#fff" : "#1a1a1a", fontSize: "14px", fontWeight: 600, cursor: "pointer" })}>
              {label}
            </button>
          ))}
        </div>

        {state.tab === "members" && (
          <>
            <p style={S({ margin: "0 0 12px", fontSize: "12px", fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: "0.05em" })}>
              Membership Snapshot · All Time
            </p>
            <div style={S({ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px", marginBottom: "24px" })}>
              <StatCard title="Current Members" subtitle="Mastermind Member · not revoked" badge="All" badgeColor="green" count={state.counts.current} isLoading={loading.current} active={state.activeView === "current"} onClick={() => setView("current")} />
              <StatCard title="Current Primary" subtitle="Primary members only" badge="Primary" badgeColor="cyan" count={state.counts.primary} isLoading={loading.primary} active={state.activeView === "primary"} onClick={() => setView("primary")} />
              <StatCard title="Current Secondary" subtitle="Under a primary member" badge="Secondary" badgeColor="purple" count={state.counts.secondary} isLoading={loading.secondary} active={state.activeView === "secondary"} onClick={() => setView("secondary")} />
            </div>

            <PeriodBar state={state} customTempStart={customTempStart} customTempEnd={customTempEnd}
              setCustomTempStart={setCustomTempStart} setCustomTempEnd={setCustomTempEnd}
              onSetPeriod={setPeriod} onApplyCustom={applyCustom}
              pastMonths={pastMonths} nextMonths={nextMonths}
              onSetSpecificMonth={(v) => setState((s) => ({ ...s, period: "specific", specificMonth: v }))} />

            <div style={S({ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px", marginBottom: "24px" })}>
              <StatCard
                title="New Joiners"
                subtitle={
                  state.newBreakdown.primary !== null && state.newBreakdown.secondary !== null
                    ? `${state.newBreakdown.primary} primary · ${state.newBreakdown.secondary} secondary`
                    : `Joined in ${range.label}`
                }
                badge="New" badgeColor="blue" count={state.counts.new} isLoading={loading.new} active={state.activeView === "new"} onClick={() => setView("new")} />
              <StatCard title="Churned" subtitle={`Revoked in ${range.label}`} badge="Churned" badgeColor="red" count={state.counts.churned} isLoading={loading.churned} active={state.activeView === "churned"} onClick={() => setView("churned")} note="Data tracked from Apr 13, 2026" />
              <StatCard title="Renewals — Actual" subtitle={`Renewed in ${range.label}`} badge="Renewed" badgeColor="yellow" count={state.counts.renewal} isLoading={loading.renewal} active={state.activeView === "renewal"} onClick={() => setView("renewal")} />
              <StatCard title="Refunded" subtitle={`Expired in ${range.label}`} badge="Refunded" badgeColor="rose" count={state.counts.refunded} isLoading={loading.refunded} active={state.activeView === "refunded"} onClick={() => setView("refunded")} />
            </div>

            <div style={S({ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px", marginBottom: "24px" })}>
              <StatCard title="Eligible Renewals" subtitle={`Expiring in ${range.label}`} badge="In period" badgeColor="orange" count={state.counts.eligible} isLoading={loading.eligible} active={state.activeView === "eligible"} onClick={() => setView("eligible")} />
              <StatCard title="Renewal Rate" subtitle={`${state.counts.renewal ?? "—"} of ${state.counts.eligible ?? "—"} eligible · ${range.label}`} badge="Actual / Eligible" badgeColor="black" count={null} displayValue={renewalRate} isLoading={loading.renewal || loading.eligible} active={false} clickable={false} />
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
            <div style={S({ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px", marginBottom: "28px" })}>
              <StatCard title="Current Members" subtitle="Mastermind Member · not revoked" badge="All" badgeColor="green" count={state.counts.current} isLoading={loading.current} active={false} clickable={false} />
              <StatCard title="Current Primary" subtitle="Primary members only" badge="Primary" badgeColor="cyan" count={state.counts.primary} isLoading={loading.primary} active={false} clickable={false} />
              <StatCard title="Current Secondary" subtitle="Under a primary member" badge="Secondary" badgeColor="purple" count={state.counts.secondary} isLoading={loading.secondary} active={false} clickable={false} />
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
                      const renewalRate = row.actual !== null && row.eligible !== null && row.eligible > 0
                        ? ((row.actual / row.eligible) * 100).toFixed(1) + "%" : "—";
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

            {/* Summary Report columns */}
            <h2 style={S({ fontSize: "16px", fontWeight: 700, marginBottom: "12px", marginTop: 0 })}>Summary Report Columns</h2>
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
                    ["New Primary",       "Members whose date_joined falls in the period — not Secondary Member, not CT Team, not revoked"],
                    ["New Secondary",     "Members whose date_joined falls in the period — has Secondary Member tag, not CT Team, not revoked"],
                    ["Total New Members", "New Primary + New Secondary"],
                    ["Churned",           "Members where community_access_revoked = true and community_access_revoked_date falls in the period"],
                    ["Refunded",          "Members with CC Refunded + Mastermind Member tags, not CT Team, expiration_date in the period"],
                    ["Actual Renewals",   "Members with Mastermind Member tag, not CT Team, latest_renewal_date falls in the period"],
                    ["Eligible Renewals", "Primary members (not Secondary, not Acquired post-CC) whose expiration_date falls in the period — see note below"],
                    ["Renewal Rate",      "Actual Renewals ÷ Eligible Renewals × 100"],
                  ].map(([col, def], i) => (
                    <tr key={col} style={S({ borderBottom: "1px solid #f0f0ee", background: i % 2 === 0 ? "#fff" : "#fafaf9" })}>
                      <td style={S({ padding: "10px 16px", fontWeight: 600, whiteSpace: "nowrap", color: "#1a1a1a" })}>{col}</td>
                      <td style={S({ padding: "10px 16px", color: "#444", lineHeight: 1.5 })}>{def}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Metric definitions */}
            {[
              {
                title: "New Primary Joiners",
                rows: [
                  ["date_joined", "falls within the selected period"],
                  ["Does not have tag", "CT Team"],
                  ["Does not have tag", "Secondary Member"],
                  ["community_access_revoked", "is not true"],
                ],
              },
              {
                title: "New Secondary Joiners",
                rows: [
                  ["date_joined", "falls within the selected period"],
                  ["Has tag", "Secondary Member"],
                  ["Does not have tag", "CT Team"],
                  ["community_access_revoked", "is not true"],
                ],
              },
              {
                title: "Churned",
                rows: [
                  ["community_access_revoked", "is true"],
                  ["community_access_revoked_date", "falls within the selected period"],
                ],
                note: "Data available from April 13, 2026 only. Churn counts for earlier periods will be 0 or incomplete.",
              },
              {
                title: "Actual Renewals",
                rows: [
                  ["Has tag", "Mastermind Member"],
                  ["Does not have tag", "CT Team"],
                  ["latest_renewal_date", "falls within the selected period"],
                ],
                note: "No revoked check — a member who renewed in the period and later churned still counts as a renewal.",
              },
              {
                title: "Refunded",
                rows: [
                  ["Has tag", "CC Refunded"],
                  ["Has tag", "Mastermind Member"],
                  ["Does not have tag", "CT Team"],
                  ["expiration_date", "falls within the selected period"],
                ],
              },
            ].map(({ title, rows, note }) => (
              <div key={title} style={S({ marginBottom: "24px" })}>
                <h3 style={S({ fontSize: "14px", fontWeight: 700, margin: "0 0 8px" })}>{title}</h3>
                <div style={S({ background: "#fff", border: "1px solid #e6e6e3", borderRadius: "10px", overflow: "hidden" })}>
                  <table style={S({ width: "100%", borderCollapse: "collapse", fontSize: "13px" })}>
                    <tbody>
                      {rows.map(([condition, value], i) => (
                        <tr key={i} style={S({ borderBottom: i < rows.length - 1 ? "1px solid #f0f0ee" : "none" })}>
                          <td style={S({ padding: "9px 16px", color: "#666", width: "220px", whiteSpace: "nowrap" })}>{condition}</td>
                          <td style={S({ padding: "9px 16px", fontWeight: 500, fontFamily: "monospace", fontSize: "12px", color: "#1a1a1a" })}>{value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {note && <p style={S({ margin: "6px 0 0", fontSize: "12px", color: "#b45309", background: "#fef9c3", padding: "6px 10px", borderRadius: "6px" })}>{note}</p>}
              </div>
            ))}

            {/* Eligible Renewals special note */}
            <div style={S({ marginBottom: "24px" })}>
              <h3 style={S({ fontSize: "14px", fontWeight: 700, margin: "0 0 8px" })}>Eligible Renewals</h3>
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
                      ["Has tag", "Mastermind Member", "Mastermind Member"],
                      ["Does not have tag", "Secondary Member", "Secondary Member"],
                      ["Does not have tag", "Acquired post-CC", "Acquired post-CC"],
                      ["Does not have tag", "CT Team", "— (not excluded)"],
                      ["community_access_revoked", "— (not checked)", "is not true"],
                      ["expiration_date", "falls within the period", "falls within the period"],
                    ].map(([condition, past, future], i, arr) => (
                      <tr key={i} style={S({ borderBottom: i < arr.length - 1 ? "1px solid #f0f0ee" : "none" })}>
                        <td style={S({ padding: "9px 16px", color: "#666", whiteSpace: "nowrap" })}>{condition}</td>
                        <td style={S({ padding: "9px 16px", fontWeight: 500, fontFamily: "monospace", fontSize: "12px", color: past.startsWith("—") ? "#999" : "#1a1a1a" })}>{past}</td>
                        <td style={S({ padding: "9px 16px", fontWeight: 500, fontFamily: "monospace", fontSize: "12px", color: future.startsWith("—") ? "#999" : "#1a1a1a" })}>{future}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={S({ margin: "6px 0 0", fontSize: "12px", color: "#b45309", background: "#fef9c3", padding: "6px 10px", borderRadius: "6px" })}>
                For past months, members who expired and did not renew are now marked revoked. Including the revoked check would exclude them and make historical eligible counts near-zero. The CT Team exclusion is dropped in current/future periods to make room for the revoked check within HubSpot&apos;s 6-filter cap.
              </p>
            </div>

            {/* Tags reference */}
            <h2 style={S({ fontSize: "16px", fontWeight: 700, marginBottom: "12px", marginTop: "8px" })}>Tags Reference</h2>
            <div style={S({ background: "#fff", border: "1px solid #e6e6e3", borderRadius: "12px", overflow: "hidden" })}>
              <table style={S({ width: "100%", borderCollapse: "collapse", fontSize: "13px" })}>
                <thead>
                  <tr style={S({ background: "#f7f7f5" })}>
                    <th style={S({ padding: "10px 16px", textAlign: "left", fontWeight: 600, fontSize: "12px", color: "#666", borderBottom: "1px solid #e6e6e3" })}>Tag</th>
                    <th style={S({ padding: "10px 16px", textAlign: "left", fontWeight: 600, fontSize: "12px", color: "#666", borderBottom: "1px solid #e6e6e3" })}>Meaning</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Mastermind Member",               "Active or former academy member"],
                    ["Secondary Member",                "Add-on seat under a primary member"],
                    ["CT Team",                         "Internal Contrarian Thinking team — excluded from all member counts"],
                    ["UA Mastermind Membership Revoked","Legacy revocation tag"],
                    ["Acquired post-CC",                "Member acquired via a non-standard channel; excluded from eligible renewals"],
                    ["CC Refunded",                     "Member received a refund"],
                    ["CC Renewal 2026",                 "Curated list of members targeted for 2026 renewal outreach"],
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

        {/* Churned data note */}
        {state.activeView === "churned" && (
          <div style={S({ background: "#fef9c3", border: "1px solid #fde68a", borderRadius: "8px", padding: "12px 16px", marginBottom: "16px", fontSize: "13px", color: "#854d0e" })}>
            <strong>Data note:</strong> The community_access_revoked_date field was first stamped on April 13, 2026.
            Revocations before this date cannot be attributed to a specific period and will not appear in period-filtered results.
          </div>
        )}

        {/* Contact table — Members tab only */}
        {state.tab === "members" && <div style={S({ background: "#fff", border: "1px solid #e6e6e3", borderRadius: "12px", overflow: "hidden" })}>
          <div style={S({ padding: "16px 20px", borderBottom: "1px solid #e6e6e3", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" })}>
            <div>
              <span style={S({ fontSize: "14px", fontWeight: 600 })}>{VIEW_TITLES[state.activeView]}</span>
              {activeTotal !== null && (
                <span style={S({ fontSize: "13px", color: "#666", marginLeft: "8px" })}>
                  {activeRows.length.toLocaleString()} of {activeTotal.toLocaleString()} shown
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
                  {cols.map((c) => (
                    <th key={c.label} style={S({ padding: "10px 16px", textAlign: "left", fontWeight: 600, fontSize: "12px", color: "#666", borderBottom: "1px solid #e6e6e3", whiteSpace: "nowrap" })}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeRows.length === 0 && !loading[state.activeView] && (
                  <tr><td colSpan={cols.length} style={S({ padding: "32px 16px", textAlign: "center", color: "#666" })}>No results for this period</td></tr>
                )}
                {activeRows.map((contact, i) => (
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
