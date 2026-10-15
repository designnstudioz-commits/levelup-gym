"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronLeft, ChevronRight, ChevronDown, CalendarDays, Users,
  Clock, Fingerprint, Download, LogIn, LogOut, Search, X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { StatsCard } from "@/components/ui/StatsCard";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { MemberAvatar } from "@/components/ui/MemberAvatar";
import { fetchAllRows } from "@/lib/utils";
import type { Device } from "@/types/database";

// The whole staff roster for one month, in one table — who turned up, on how
// many days, and when. /dashboard/attendance/member can already show one
// person's month, but answering "did everyone come in this month" through it
// means searching thirty people one at a time. This is the roster view: every
// staff member listed, sorted by who attended most, expandable to the
// day-by-day detail.
//
// Staff punches are filed against attendances.staff_id (members use
// member_id), which is why this is a separate query rather than a filter on
// the main attendance page.

interface StaffRow {
  id: string;
  full_name: string;
  role: string | null;
  photo_url: string | null;
  status: string;
}

interface Punch {
  id: string;
  staff_id: string;
  punch_time: string;
  punch_type: string | null;
  device_id: string | null;
}

interface DayGroup {
  key: string;
  punches: Punch[];
  firstIn: Punch | null;
  lastOut: Punch | null;
  minutes: number | null;
}

interface StaffSummary {
  staff: StaffRow;
  days: DayGroup[];
  punches: number;
  firstDay: string | null;
  lastDay: string | null;
  avgArrival: string;
}

const PKT = "Asia/Karachi";

function pktDayKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: PKT });
}

function pktTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-PK", {
    timeZone: PKT, hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

function pktMinutes(iso: string): number {
  const hhmm = new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: PKT, hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

function minutesToClock(mins: number): string {
  const m = Math.round(mins);
  const h24 = Math.floor(m / 60);
  const h12 = ((h24 + 11) % 12) + 1;
  return `${h12}:${String(m % 60).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

function durationLabel(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

function currentYm(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: PKT }).slice(0, 7);
}

function shiftYm(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthMeta(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-PK", {
    month: "long", year: "numeric", timeZone: "UTC",
  });
  return { days, label, start: `${ym}-01`, end: `${ym}-${String(days).padStart(2, "0")}` };
}

function groupDays(list: Punch[]): DayGroup[] {
  const map = new Map<string, Punch[]>();
  for (const p of list) {
    const k = pktDayKey(p.punch_time);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(p);
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, punches]) => {
      const sorted  = [...punches].sort((a, b) => a.punch_time.localeCompare(b.punch_time));
      const firstIn = sorted.find((p) => p.punch_type === "in") ?? null;
      const outs    = sorted.filter((p) => p.punch_type === "out");
      const lastOut = outs.length ? outs[outs.length - 1] : null;
      // Only a genuine in-then-out pair gives a duration. Plenty of people
      // never punch out, and inventing a closing time would turn a blank
      // into a number somebody might pay against.
      const minutes =
        firstIn && lastOut && new Date(lastOut.punch_time) > new Date(firstIn.punch_time)
          ? Math.round(
              (new Date(lastOut.punch_time).getTime() - new Date(firstIn.punch_time).getTime()) / 60000
            )
          : null;
      return { key, punches: sorted, firstIn, lastOut, minutes };
    });
}

export default function StaffAttendancePage() {
  const [ym, setYm]           = useState(currentYm);
  const [staff, setStaff]     = useState<StaffRow[]>([]);
  // Staff code (the device PIN) keyed by staff id. Empty for roles that
  // cannot read it — see the load() comment.
  const [codes, setCodes]     = useState<Record<string, string>>({});
  const [punches, setPunches] = useState<Punch[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter]   = useState("");
  const [showAll, setShowAll] = useState(false);

  const meta   = useMemo(() => monthMeta(ym), [ym]);
  const thisYm = currentYm();

  useEffect(() => {
    createClient().from("devices").select("*").order("name")
      .then(({ data }) => setDevices((data as Device[] | null) ?? []));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();

    // staff_directory_public, NOT staff_members: direct reads of the base
    // table were narrowed to owner/manager by the 2026-09-13 salary/CNIC
    // column-leak fix, so a receptionist or trainer hitting the table gets
    // zero rows and no error. The view is granted to every authenticated
    // role, so this page looks the same for all four.
    const [{ data: roster }, allPunches, { data: codeRows }] = await Promise.all([
      supabase
        .from("staff_directory_public")
        .select("id, full_name, role, photo_url, status")
        .order("full_name"),
      // ~3,000 staff punches in a busy month, well past the 1000-row
      // PostgREST ceiling — paged, or the tail of the month silently
      // disappears and everyone looks like they stopped coming.
      fetchAllRows<Punch>((from, to) =>
        supabase
          .from("attendances")
          .select("id, staff_id, punch_time, punch_type, device_id")
          .not("staff_id", "is", null)
          .gte("punch_time", `${meta.start}T00:00:00+05:00`)
          .lte("punch_time", `${meta.end}T23:59:59+05:00`)
          .order("punch_time", { ascending: true })
          .range(from, to)
      ),
      // The staff code is device_user_id, which lives only on
      // staff_members — readable by owner/manager, since the 2026-09-13
      // column-leak fix narrowed that table. RLS filters rather than
      // errors, so a receptionist or trainer simply gets an empty list
      // here and the code column is hidden for them rather than showing
      // blanks. That matches the rest of the app: /dashboard/staff is
      // already owner/manager only, so staff codes are an owner/manager
      // concept everywhere else too.
      supabase.from("staff_members").select("id, device_user_id").is("deleted_at", null),
    ]);

    setStaff((roster as StaffRow[] | null) ?? []);
    setPunches(allPunches);
    setCodes(Object.fromEntries(
      ((codeRows as { id: string; device_user_id: string | null }[] | null) ?? [])
        .filter((r) => r.device_user_id)
        .map((r) => [r.id, r.device_user_id as string])
    ));
    setLoading(false);
  }, [meta.start, meta.end]);

  useEffect(() => { load(); }, [load]);

  const summaries: StaffSummary[] = useMemo(() => {
    const byStaff = new Map<string, Punch[]>();
    for (const p of punches) {
      if (!p.staff_id) continue;
      if (!byStaff.has(p.staff_id)) byStaff.set(p.staff_id, []);
      byStaff.get(p.staff_id)!.push(p);
    }

    return staff
      .map((s) => {
        const days = groupDays(byStaff.get(s.id) ?? []);
        const keys = days.map((d) => d.key).sort();
        const arrivals = days.map((d) => pktMinutes((d.firstIn ?? d.punches[0]).punch_time));
        return {
          staff: s,
          days,
          punches: (byStaff.get(s.id) ?? []).length,
          firstDay: keys[0] ?? null,
          lastDay: keys.length ? keys[keys.length - 1] : null,
          avgArrival: arrivals.length
            ? minutesToClock(arrivals.reduce((a, b) => a + b, 0) / arrivals.length)
            : "—",
        };
      })
      // Most days present first; someone who never came sinks to the bottom.
      .sort((a, b) => b.days.length - a.days.length || a.staff.full_name.localeCompare(b.staff.full_name));
  }, [staff, punches]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return summaries.filter((s) => {
      if (!showAll && s.staff.status !== "active") return false;
      if (!q) return true;
      return s.staff.full_name.toLowerCase().includes(q) ||
             (s.staff.role ?? "").toLowerCase().includes(q) ||
             (codes[s.staff.id] ?? "").includes(q);
    });
  }, [summaries, filter, showAll, codes]);

  // Whether this session can see staff codes at all. Drives both the
  // placeholder wording and the CSV column, so the page never advertises a
  // search that cannot work for the person reading it.
  const hasCodes = Object.keys(codes).length > 0;

  const totals = useMemo(() => {
    const came = visible.filter((s) => s.days.length > 0);
    const totalPunches = visible.reduce((a, s) => a + s.punches, 0);
    const avgDays = came.length
      ? (came.reduce((a, s) => a + s.days.length, 0) / came.length).toFixed(1)
      : "0";
    return { came: came.length, roster: visible.length, totalPunches, avgDays };
  }, [visible]);

  function deviceInfo(serial: string | null): { name: string; color: string } {
    const d = devices.find((x) => x.serial_no === serial);
    return { name: d?.name ?? serial ?? "Unknown door", color: d?.color ?? "#7A7A72" };
  }

  function downloadCsv() {
    const rows: string[][] = [
      [...(hasCodes ? ["Staff Code"] : []), "Staff", "Role", "Status",
       "Days Present", "Days in Month", "Total Punches", "First Day", "Last Day", "Usual Arrival"],
      ...visible.map((s) => [
        ...(hasCodes ? [codes[s.staff.id] ?? ""] : []),
        s.staff.full_name, s.staff.role ?? "", s.staff.status,
        String(s.days.length), String(meta.days), String(s.punches),
        s.firstDay ?? "", s.lastDay ?? "", s.avgArrival,
      ]),
    ];
    const csv = rows
      .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `staff-attendance-${ym}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-[#F8F8F6]">
      <DashboardHeader
        title="Staff Attendance"
        subtitle="Every staff member's month at a glance — click a row for the day-by-day detail"
      />

      <div className="p-6 space-y-5 max-w-6xl">
        {/* ── Month + filters ─────────────────────────────────────── */}
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setYm(shiftYm(ym, -1))}
                className="w-8 h-8 rounded-lg border border-[#E4E4DE] bg-white flex items-center justify-center hover:bg-[#F8F8F6]"
                aria-label="Previous month"
              >
                <ChevronLeft className="w-4 h-4 text-[#4A4A44]" />
              </button>
              <span className="text-sm font-semibold text-[#1A1A16] min-w-36 text-center">{meta.label}</span>
              <button
                onClick={() => setYm(shiftYm(ym, 1))}
                disabled={ym >= thisYm}
                className="w-8 h-8 rounded-lg border border-[#E4E4DE] bg-white flex items-center justify-center hover:bg-[#F8F8F6] disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Next month"
              >
                <ChevronRight className="w-4 h-4 text-[#4A4A44]" />
              </button>
              {ym !== thisYm && (
                <Button variant="ghost" size="sm" onClick={() => setYm(thisYm)}>This month</Button>
              )}
            </div>

            <div className="flex-1 min-w-40 max-w-xs relative">
              <Search className="w-4 h-4 text-[#7A7A72] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={filter}
                placeholder={hasCodes ? "Filter by name, role or staff code…" : "Filter by name or role…"}
                onChange={(e) => setFilter(e.target.value)}
                className="w-full pl-9 pr-8 py-2 text-sm rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]"
              />
              {filter && (
                <button
                  onClick={() => setFilter("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#7A7A72] hover:text-[#1A1A16]"
                  aria-label="Clear filter"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <label className="flex items-center gap-2 text-xs text-[#4A4A44] cursor-pointer">
              <input
                type="checkbox" checked={showAll}
                onChange={(e) => setShowAll(e.target.checked)}
                className="rounded border-[#E4E4DE] accent-[#F06418]"
              />
              Include inactive staff
            </label>

            <Button variant="secondary" size="sm" onClick={downloadCsv} disabled={visible.length === 0}>
              <Download className="w-4 h-4 mr-1" /> CSV
            </Button>
          </div>
        </Card>

        {/* ── Stats ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard
            title="Staff Who Came" value={`${totals.came} of ${totals.roster}`} icon={Users}
            iconColor="#F06418" iconBg="#FEF0E8" loading={loading}
          />
          <StatsCard
            title="Total Punches" value={totals.totalPunches} icon={Fingerprint}
            iconColor="#2563EB" iconBg="#EFF6FF" loading={loading}
          />
          <StatsCard
            title="Average Days Each" value={totals.avgDays} icon={CalendarDays}
            iconColor="#059669" iconBg="#ECFDF5" loading={loading}
          />
          <StatsCard
            title="Days in Month" value={meta.days} icon={Clock}
            iconColor="#7C3AED" iconBg="#F5F3FF" loading={loading}
          />
        </div>

        {/* ── Roster ──────────────────────────────────────────────── */}
        <Card padding={false}>
          <div className="px-5 py-4 border-b border-[#E4E4DE] flex items-center gap-2">
            <Users className="w-4 h-4 text-[#F06418]" />
            <h3 className="text-sm font-semibold text-[#1A1A16]">{meta.label}</h3>
            <span className="ml-auto text-xs text-[#7A7A72]">Most days first</span>
          </div>

          {loading ? (
            <div className="px-5 py-12 text-center text-sm text-[#7A7A72]">Loading the month…</div>
          ) : visible.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-sm font-semibold text-[#1A1A16]">No staff to show</p>
              <p className="text-xs text-[#7A7A72] mt-1">
                {filter ? "Nothing matches that filter." : "The staff directory is empty."}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#E4E4DE]">
              {visible.map((s) => {
                const open = expanded === s.staff.id;
                const pct  = Math.round((s.days.length / meta.days) * 100);
                return (
                  <div key={s.staff.id}>
                    <button
                      onClick={() => setExpanded(open ? null : s.staff.id)}
                      className="w-full px-5 py-3 flex items-center gap-3 hover:bg-[#F8F8F6] transition-colors text-left"
                    >
                      <ChevronDown
                        className={`w-4 h-4 text-[#7A7A72] flex-shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
                      />
                      <MemberAvatar photoUrl={s.staff.photo_url} name={s.staff.full_name} size={72} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-[#1A1A16] truncate">
                          {s.staff.full_name}
                          {s.staff.status !== "active" && (
                            <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-[#7A7A72]">Inactive</span>
                          )}
                        </div>
                        <div className="text-xs text-[#7A7A72] flex items-center gap-1.5">
                          <span>{s.staff.role ?? "Staff"}</span>
                          {codes[s.staff.id] && (
                            <span className="font-mono text-[10px] px-1 py-px rounded bg-[#F8F8F6] border border-[#E4E4DE] text-[#4A4A44]">
                              {codes[s.staff.id]}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Attendance bar — a glance comparison down the column */}
                      <div className="hidden sm:block w-28 flex-shrink-0">
                        <div className="h-1.5 rounded-full bg-[#E4E4DE] overflow-hidden">
                          <div className="h-full rounded-full bg-[#F06418]" style={{ width: `${pct}%` }} />
                        </div>
                      </div>

                      <div className="w-24 text-right flex-shrink-0">
                        <div className="text-sm font-bold text-[#1A1A16]">
                          {s.days.length}<span className="text-[#7A7A72] font-medium"> / {meta.days}</span>
                        </div>
                        <div className="text-[10px] text-[#7A7A72]">days present</div>
                      </div>

                      <div className="hidden md:block w-24 text-right flex-shrink-0">
                        <div className="text-xs font-medium text-[#1A1A16]">{s.avgArrival}</div>
                        <div className="text-[10px] text-[#7A7A72]">usual arrival</div>
                      </div>
                    </button>

                    {open && (
                      <div className="bg-[#F8F8F6] border-t border-[#E4E4DE]">
                        {s.days.length === 0 ? (
                          <div className="px-5 py-6 text-center text-xs text-[#7A7A72]">
                            {s.staff.full_name} did not punch at any door in {meta.label}.
                          </div>
                        ) : (
                          <>
                            <div className="px-5 py-2 flex items-center gap-3 text-[10px] text-[#7A7A72] border-b border-[#E4E4DE]">
                              <span>{s.punches} punches</span>
                              <span>·</span>
                              <span>first {s.firstDay}</span>
                              <span>·</span>
                              <span>last {s.lastDay}</span>
                              <Link
                                href={`/dashboard/staff/${s.staff.id}`}
                                className="ml-auto text-[#F06418] font-semibold hover:underline"
                              >
                                Open profile →
                              </Link>
                            </div>
                            <div className="divide-y divide-[#E4E4DE]">
                              {s.days.map((d) => (
                                <div key={d.key} className="px-5 py-2.5 flex items-start gap-4">
                                  <div className="w-12 flex-shrink-0 text-center">
                                    <div className="text-base font-bold text-[#1A1A16] leading-none">
                                      {Number(d.key.slice(8))}
                                    </div>
                                    <div className="text-[10px] uppercase tracking-wide text-[#7A7A72] mt-0.5">
                                      {new Date(`${d.key}T12:00:00Z`).toLocaleDateString("en-PK", { weekday: "short", timeZone: "UTC" })}
                                    </div>
                                  </div>
                                  <div className="flex-1 min-w-0 flex flex-wrap gap-1.5">
                                    {d.punches.map((p) => {
                                      const dev = deviceInfo(p.device_id);
                                      return (
                                        <span
                                          key={p.id}
                                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-white border border-[#E4E4DE]"
                                          title={dev.name}
                                        >
                                          {p.punch_type === "in"
                                            ? <LogIn className="w-3 h-3 text-green-600" />
                                            : p.punch_type === "out"
                                              ? <LogOut className="w-3 h-3 text-[#F06418]" />
                                              : <Fingerprint className="w-3 h-3 text-[#7A7A72]" />}
                                          <span className="text-[#1A1A16]">{pktTime(p.punch_time)}</span>
                                          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: dev.color }} />
                                        </span>
                                      );
                                    })}
                                  </div>
                                  <div className="text-right flex-shrink-0 w-20">
                                    {d.minutes !== null ? (
                                      <div className="text-xs font-semibold text-[#1A1A16]">{durationLabel(d.minutes)}</div>
                                    ) : (
                                      <div className="text-[10px] text-[#7A7A72]">no check-out</div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <p className="text-xs text-[#7A7A72]">
          Days present counts any day with at least one punch. Time inside is only shown where a
          check-in is followed by a check-out on the same day — most people do not scan on the way out.
        </p>
      </div>
    </div>
  );
}
