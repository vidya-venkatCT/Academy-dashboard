export type PeriodType = "week" | "month" | "quarter" | "year" | "custom" | "specific";

export interface PeriodState {
  period: PeriodType;
  customStart: string | null;
  customEnd: string | null;
  specificMonth: string; // "YYYY-MM" or "all"
}

export interface PeriodRange {
  start: string;
  end: string;
  label: string;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function getPeriodRange(state: PeriodState): PeriodRange {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth(); // 0-indexed

  switch (state.period) {
    case "week": {
      const dow = today.getDay(); // 0=Sun
      const diff = dow === 0 ? -6 : 1 - dow; // shift to Monday
      const mon = new Date(today);
      mon.setDate(today.getDate() + diff);
      const sun = new Date(mon);
      sun.setDate(mon.getDate() + 6);
      return { start: toISO(mon), end: toISO(sun), label: "this week" };
    }
    case "month": {
      const last = lastDayOfMonth(y, m + 1);
      const label = today.toLocaleString("en-US", { month: "long", year: "numeric" });
      return {
        start: `${y}-${pad(m + 1)}-01`,
        end: `${y}-${pad(m + 1)}-${pad(last)}`,
        label,
      };
    }
    case "quarter": {
      const q = Math.floor(m / 3); // 0..3
      const startMonth = q * 3 + 1; // 1,4,7,10
      const endMonth = q * 3 + 3;   // 3,6,9,12
      const last = lastDayOfMonth(y, endMonth);
      const qNum = q + 1;
      return {
        start: `${y}-${pad(startMonth)}-01`,
        end: `${y}-${pad(endMonth)}-${pad(last)}`,
        label: `Q${qNum} ${y}`,
      };
    }
    case "year": {
      return {
        start: `${y}-01-01`,
        end: `${y}-12-31`,
        label: `${y}`,
      };
    }
    case "custom": {
      const s = state.customStart ?? toISO(today);
      const e = state.customEnd ?? toISO(today);
      return { start: s, end: e, label: `${s} → ${e}` };
    }
    case "specific": {
      if (state.specificMonth === "all") {
        return {
          start: toISO(today),
          end: "2099-12-31",
          label: "all future",
        };
      }
      const [sy, sm] = state.specificMonth.split("-").map(Number);
      const last = lastDayOfMonth(sy, sm);
      const label = new Date(sy, sm - 1, 1).toLocaleString("en-US", {
        month: "long",
        year: "numeric",
      });
      return {
        start: `${sy}-${pad(sm)}-01`,
        end: `${sy}-${pad(sm)}-${pad(last)}`,
        label,
      };
    }
    default:
      return { start: toISO(today), end: toISO(today), label: "today" };
  }
}

/** Returns last 13 months (current + 12 past) as "YYYY-MM" strings, newest first */
export function getSpecificMonthOptions(): { value: string; label: string }[] {
  const today = new Date();
  const opts: { value: string; label: string }[] = [];
  for (let i = 0; i < 13; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    const label = d.toLocaleString("en-US", { month: "long", year: "numeric" });
    opts.push({ value, label });
  }
  return opts;
}

/** Next 12 months starting from next month, newest last */
export function getNextMonthOptions(): { value: string; label: string }[] {
  const today = new Date();
  const opts: { value: string; label: string }[] = [];
  for (let i = 1; i <= 12; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    const label = d.toLocaleString("en-US", { month: "long", year: "numeric" });
    opts.push({ value, label });
  }
  return opts;
}

export function currentMonthValue(): string {
  const today = new Date();
  return `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;
}
