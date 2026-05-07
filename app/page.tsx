"use client";

import { useState, useEffect, useCallback } from "react";
import {
  currentAllFilters,
  primaryBaseFilters,
  currentSecondaryFilters,
  newJoinersFilters,
  churnedFilters,
  renewalActualFilters,
  eligibleRenewalFilters,
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

interface State {
  tab: "members" | "upcoming";
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
}

type LoadingMap = Record<ViewKey, boolean>;

const cache = new Map<string, { data: HubSpotResult; ts: number }>();
const CACHE_TTL = 30_000;

interface HubSpotResult {
  total: number;
  results: Contact[];
  paging?: { next?: { after: string } };
}

function cacheKey(filters: HubSpotFilter[], after?: string): string {
  return JSON.stringify({ filters, after });
}

async function searchContacts(filters: HubSpotFilter[], after?: string): Promise<HubSpotResult> {
  const key = cacheKey(filters, after);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const res = await fetch("/api/hubspot-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filterGroups: [{ filters }],
      properties: CONTACT_PROPERTIES,
      limit: 100,
      after,
    }),
  });

  if (!res.ok) throw new Error(`API error ${res.status}`);
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

function StatCard({ title, subtitle, badge, badgeColor, count, isLoading, active, onClick, clickable = true, note }: {
  title: string; subtitle?: string; badge: string; badgeColor: string;
  count: number | null; isLoading: boolean; active: boolean; onClick?: () => void;
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
          : count !== null ? count.toLocaleString() : "—"}
      </div>
      <div style={{ fontSize: "13px", fontWeight: 600, color: "#1a1a1a" }}>{title}</div>
      {subtitle && <div style={{ fontSize: "12px", color: "#666", marginTop: "2px" }}>{subtitle}</div>}
      {note && <div style={{ fontSize: "11px", color: "#b45309", marginTop: "6px", background: "#fef9c3", padding: "4px 8px", borderRadius: "4px" }}>{note}</div>}
    </div>
  );
}

function viewFilters(view: ViewKey, start: string, end: string): HubSpotFilter[] {
  switch (view) {
    case "current":   return currentAllFilters();
    case "primary":   return primaryBaseFilters();
    case "secondary": return currentSecondaryFilters();
    case "new":       return newJoinersFilters(start, end);
    case "churned":   return churnedFilters(start, end);
    case "renewal":   return renewalActualFilters(start, end);
    case "eligible":  return eligibleRenewalFilters(start, end);
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
    activeView: "primary",
    counts: makeNullRecord(null),
    rows: makeNullRecord([]) as Record<ViewKey, Contact[]>,
    totals: makeNullRecord(null),
    offsets: makeNullRecord(undefined) as Record<ViewKey, string | undefined>,
    loadingMore: false,
  });

  const [loading, setLoading] = useState<LoadingMap>(makeNullRecord(true) as LoadingMap);
  const [customTempStart, setCustomTempStart] = useState(d30start);
  const [customTempEnd, setCustomTempEnd] = useState(d30end);
  const [downloadProgress, setDownloadProgress] = useState<string | null>(null);

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
    }));

    const [newJ, churn, renew, elig, refund] = await Promise.allSettled([
      searchContacts(newJoinersFilters(start, end)),
      searchContacts(churnedFilters(start, end)),
      searchContacts(renewalActualFilters(start, end)),
      searchContacts(eligibleRenewalFilters(start, end)),
      searchContacts(refundedFilters(start, end)),
    ]);

    setState((s) => {
      const v = (r: PromiseSettledResult<HubSpotResult>) => r.status === "fulfilled" ? r.value : null;
      return {
        ...s,
        counts:  { ...s.counts,  new: v(newJ)?.total ?? null, churned: v(churn)?.total ?? null, renewal: v(renew)?.total ?? null, eligible: v(elig)?.total ?? null, refunded: v(refund)?.total ?? null },
        rows:    { ...s.rows,    new: v(newJ)?.results ?? [], churned: v(churn)?.results ?? [], renewal: v(renew)?.results ?? [], eligible: v(elig)?.results ?? [], refunded: v(refund)?.results ?? [] },
        totals:  { ...s.totals,  new: v(newJ)?.total ?? null, churned: v(churn)?.total ?? null, renewal: v(renew)?.total ?? null, eligible: v(elig)?.total ?? null, refunded: v(refund)?.total ?? null },
        offsets: { ...s.offsets, new: v(newJ)?.paging?.next?.after, churned: v(churn)?.paging?.next?.after, renewal: v(renew)?.paging?.next?.after, eligible: v(elig)?.paging?.next?.after, refunded: v(refund)?.paging?.next?.after },
      };
    });
    setLoading((l) => ({ ...l, new: false, churned: false, renewal: false, eligible: false, refunded: false }));
  }, []);

  useEffect(() => { loadSnapshotViews(); }, [loadSnapshotViews]);
  useEffect(() => { loadPeriodViews(range.start, range.end); }, // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.period, state.customStart, state.customEnd, state.specificMonth]);

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
          {(["members", "upcoming"] as const).map((t) => (
            <button key={t} onClick={() => setState((s) => ({ ...s, tab: t, activeView: t === "upcoming" ? "eligible" : "primary" }))}
              style={S({ padding: "8px 20px", borderRadius: "8px", border: "1px solid #e6e6e3", background: state.tab === t ? "#1a1a1a" : "#fff", color: state.tab === t ? "#fff" : "#1a1a1a", fontSize: "14px", fontWeight: 600, cursor: "pointer" })}>
              {t === "members" ? "Members" : "Eligible Renewals"}
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
              <StatCard title="New Joiners" subtitle={`Joined in ${range.label}`} badge="New" badgeColor="blue" count={state.counts.new} isLoading={loading.new} active={state.activeView === "new"} onClick={() => setView("new")} />
              <StatCard title="Churned" subtitle={`Revoked in ${range.label}`} badge="Churned" badgeColor="red" count={state.counts.churned} isLoading={loading.churned} active={state.activeView === "churned"} onClick={() => setView("churned")} note="Data tracked from Apr 13, 2026" />
              <StatCard title="Renewals — Actual" subtitle={`Renewed in ${range.label}`} badge="Renewed" badgeColor="yellow" count={state.counts.renewal} isLoading={loading.renewal} active={state.activeView === "renewal"} onClick={() => setView("renewal")} />
              <StatCard title="Refunded" subtitle={`Expired in ${range.label}`} badge="Refunded" badgeColor="rose" count={state.counts.refunded} isLoading={loading.refunded} active={state.activeView === "refunded"} onClick={() => setView("refunded")} />
            </div>

            <div style={S({ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px", marginBottom: "24px" })}>
              <StatCard title="Eligible Renewals" subtitle={`Expiring in ${range.label}`} badge="In period" badgeColor="orange" count={state.counts.eligible} isLoading={loading.eligible} active={state.activeView === "eligible"} onClick={() => setView("eligible")} />
              <StatCard title="Renewal Rate" subtitle={`${state.counts.renewal ?? "—"} of ${state.counts.eligible ?? "—"} eligible · ${range.label}`} badge="Actual / Eligible" badgeColor="black" count={null} isLoading={loading.renewal || loading.eligible} active={false} clickable={false}
                note={renewalRate !== "—" ? `Rate: ${renewalRate}` : undefined} />
            </div>
          </>
        )}

        {state.tab === "upcoming" && (
          <>
            <PeriodBar state={state} customTempStart={customTempStart} customTempEnd={customTempEnd}
              setCustomTempStart={setCustomTempStart} setCustomTempEnd={setCustomTempEnd}
              onSetPeriod={setPeriod} onApplyCustom={applyCustom}
              pastMonths={pastMonths} nextMonths={nextMonths}
              onSetSpecificMonth={(v) => setState((s) => ({ ...s, period: "specific", specificMonth: v }))} />
            <div style={S({ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px", marginBottom: "24px", maxWidth: "350px" })}>
              <StatCard title="Eligible Renewals" subtitle={`Expiring in ${range.label}`} badge="By month" badgeColor="pink" count={state.counts.eligible} isLoading={loading.eligible} active={state.activeView === "eligible"} onClick={() => setView("eligible")} />
            </div>
          </>
        )}

        {/* Churned data note */}
        {state.activeView === "churned" && (
          <div style={S({ background: "#fef9c3", border: "1px solid #fde68a", borderRadius: "8px", padding: "12px 16px", marginBottom: "16px", fontSize: "13px", color: "#854d0e" })}>
            <strong>Data note:</strong> The community_access_revoked_date field was first stamped on April 13, 2026.
            Revocations before this date cannot be attributed to a specific period and will not appear in period-filtered results.
          </div>
        )}

        {/* Table */}
        <div style={S({ background: "#fff", border: "1px solid #e6e6e3", borderRadius: "12px", overflow: "hidden" })}>
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
        </div>
      </div>
    </div>
  );
}
