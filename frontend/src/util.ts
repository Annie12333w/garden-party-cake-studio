import { useCallback, useEffect, useRef, useState } from "react";
import type { OrderStatus } from "./types";

export const money = (n: number | null | undefined, cents = false): string =>
  n === null || n === undefined || Number.isNaN(n)
    ? "–"
    : n.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: cents ? 2 : 0,
        maximumFractionDigits: cents ? 2 : n % 1 === 0 ? 0 : 2,
      });

export const usd4 = (n: number | null | undefined): string =>
  n === null || n === undefined ? "–" : `$${n < 0.01 ? n.toFixed(5) : n.toFixed(4)}`;

export const num = (n: number | null | undefined): string =>
  n === null || n === undefined ? "–" : n.toLocaleString("en-US");

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const weekdayName = (i: number) => WEEKDAYS[i] ?? "?";

/** Parse YYYY-MM-DD as a local date (no timezone shift). */
export function parseDate(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
export function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}
/** Monday of the week containing d. */
export function mondayOf(d: Date): Date {
  const c = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const wd = (c.getDay() + 6) % 7; // 0 = Mon
  return addDays(c, -wd);
}
export function nextMonday(d: Date): Date {
  return addDays(mondayOf(d), 7);
}

export function prettyDate(s: string | null | undefined, opts: Intl.DateTimeFormatOptions = {}): string {
  if (!s) return "–";
  const d = s.length <= 10 ? parseDate(s) : new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", ...opts });
}
export function prettyDateTime(s: string | null | undefined): string {
  if (!s) return "–";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
export function prettyTime(t: string | null | undefined): string {
  if (!t) return "–";
  const hm = t.length > 5 && t.includes("T") ? t.slice(11, 16) : t.slice(0, 5);
  const [h, m] = hm.split(":").map(Number);
  if (Number.isNaN(h)) return t;
  const ampm = h >= 12 ? "pm" : "am";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}${m ? `:${String(m).padStart(2, "0")}` : ""}${ampm}`;
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  requested: "Awaiting review",
  accepted: "Accepted · deposit due",
  confirmed: "Confirmed",
  in_production: "In the kitchen",
  ready: "Ready",
  completed: "Picked up",
  declined: "Declined",
  cancelled: "Cancelled",
  expired: "Hold expired",
};
export const STATUS_FLOW: OrderStatus[] = ["requested", "accepted", "confirmed", "in_production", "ready", "completed"];

export function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Load data with loading/error state and a reload function. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fnRef.current();
      setData(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, setData, error, loading, reload };
}

/** Poll an agent run until it is no longer running. */
export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
