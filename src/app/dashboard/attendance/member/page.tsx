"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Search, X, ChevronLeft, ChevronRight, CalendarDays, Flame,
  Clock, Fingerprint, Download, LogIn, LogOut, UserSearch,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { StatsCard } from "@/components/ui/StatsCard";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { MemberAvatar } from "@/components/ui/MemberAvatar";
import { getMemberStatusDisplay } from "@/lib/utils";
import type { Device } from "@/types/database";

// One member, one month. The main /dashboard/attendance page answers "who is
// in the gym right now" — it is gym-wide, capped at 500 rows and cannot look
// further back than the start of the current month. This page answers the
// other question: "how often did THIS member come, in THAT month".

interface MemberHit {
  id: string;
  full_name: string;
  membership_no: string;
  photo_url: string | null;
  phone: string | null;
  status: string;
  expiry_date: string | null;
}

interface Punch {
  id: string;
  punch_time: string;
  punch_type: string | null;
  device_id: string | null;
}

interface DayGroup {
  key: string;            // yyyy-MM-dd, Pakistani calendar day
  punches: Punch[];
  firstIn: Punch | null;
  lastOut: Punch | null;
  minutes: number | null; // time inside, only when a real in/out pair exists
}

const PKT = "Asia/Karachi";

// Timestamps are stored in UTC. A punch at 02:00 PKT is 21:00 UTC the day
// before, so grouping by the raw date would file it under the wrong day.
// en-CA gives yyyy-MM-dd, which sorts and compares as a plain string.
function pktDayKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: PKT });
}

function pktTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-PK", {
    timeZone: PKT, hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

/** Minutes past midnight PKT — for averaging arrival times. */
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
  const ampm = h24 < 12 ? "AM" : "PM";
  return `${h12}:${String(m % 60).padStart(2, "0")} ${ampm}`;
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
  // Day 0 of the following month is the last day of this one.
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  // Monday-first grid, matching the week start used elsewhere in the app.
  const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-PK", {
    month: "long", year: "numeric", timeZone: "UTC",
  });
  return {
    y, m, days, firstDow, label,
    start: `${ym}-01`,
    end: `${ym}-${String(days).padStart(2, "0")}`,
  };
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function MemberAttendancePage() {
  const [query, setQuery]         = useState("");
  const [hits, setHits]           = useState<MemberHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [showHits, setShowHits]   = useState(false);
  const [member, setMember]       = useState<MemberHit | null>(null);

  const [ym, setYm]           = useState(currentYm);
  const [punches, setPunches] = useState<Punch[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(false);

  const boxRef   = useRef<HTMLDivElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const meta     = useMemo(() => monthMeta(ym), [ym]);
  const thisYm   = currentYm();
  const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: PKT });

  // ── Member search ──────────────────────────────────────────────────────
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    const q = query.trim();
    if (q.length < 2) { setHits([]); setSearching(false); return; }

    setSearching(true);
    debounce.current = setTimeout(async () => {
      // PostgREST splits or() on commas and parentheses, so a stray one in
      // the box would corrupt the filter rather than simply not match.
      const safe = q.replace(/[,()*\\]/g, " ").trim();
      if (!safe) { setHits([]); setSearching(false); return; }

      const { data } = await createClient()
        .from("members")
        .select("id, full_name, membership_no, photo_url, phone, status, expiry_date")
        .is("deleted_at", null)
        .or(`full_name.ilike.%${safe}%,membership_no.ilike.%${safe}%,phone.ilike.%${safe}%`)
        .order("full_name")
        .limit(8);

      setHits((data as MemberHit[] | null) ?? []);
      setSearching(false);
    }, 250);

    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [query]);

  // Close the suggestion list when the click lands outside it.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setShowHits(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  useEffect(() => {
    createClient().from("devices").select("*").order("name")
      .then(({ data }) => setDevices((data as Device[] | null) ?? []));
  }, []);

  // ── Punches for the chosen member + month ──────────────────────────────
  const fetchPunches = useCallback(async () => {
    if (!member) { setPunches([]); return; }
    setLoading(true);
    // Bounds are written in PKT so the month starts at local midnight rather
    // than 05:00. One member's month cannot approach the 1000-row ceiling.
    const { data } = await createClient()
      .from("attendances")
      .select("id, punch_time, punch_type, device_id")
      .eq("member_id", member.id)
      .gte("punch_time", `${meta.start}T00:00:00+05:00`)
      .lte("punch_time", `${meta.end}T23:59:59+05:00`)
      .order("punch_time", { ascending: true })
      .limit(1000);
    setPunches((data as Punch[] | null) ?? []);
    setLoading(false);
  }, [member, meta.start, meta.end]);

  useEffect(() => { fetchPunches(); }, [fetchPunches]);

  // ── Group into days ────────────────────────────────────────────────────
  const days: DayGroup[] = useMemo(() => {
    const map = new Map<string, Punch[]>();
    for (const p of punches) {
      const k = pktDayKey(p.punch_time);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(p);
    }
    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, list]) => {
        const firstIn = list.find((p) => p.punch_type === "in") ?? null;
        const outs    = list.filter((p) => p.punch_type === "out");
        const lastOut = outs.length ? outs[outs.length - 1] : null;
        // Only a genuine in-then-out pair gives a duration. Most members
        // never punch out, so assuming a closing time would invent numbers.
        const minutes =
          firstIn && lastOut && new Date(lastOut.punch_time) > new Date(firstIn.punch_time)
            ? Math.round(
                (new Date(lastOut.punch_time).getTime() - new Date(firstIn.punch_time).getTime()) / 60000
              )
            : null;
        return { key, punches: list, firstIn, lastOut, minutes };
      });
  }, [punches]);

  const presentKeys = useMemo(() => new Set(days.map((d) => d.key)), [days]);

  const stats = useMemo(() => {
    const arrivals = days.map((d) => pktMinutes((d.firstIn ?? d.punches[0]).punch_time));
    const avgArrival = arrivals.length
      ? minutesToClock(arrivals.reduce((a, b) => a + b, 0) / arrivals.length)
      : "—";

    // Longest run of consecutive calendar days with at least one punch.
    const sorted = [...presentKeys].sort();
    let best = 0, run = 0;
    let prev: string | null = null;
    for (const k of sorted) {
      if (prev) {
        const gap = (Date.parse(`${k}T00:00:00Z`) - Date.parse(`${prev}T00:00:00Z`)) / 86400000;
        run = gap === 1 ? run + 1 : 1;
      } else run = 1;
      best = Math.max(best, run);
      prev = k;
    }

    const timed = days.filter((d) => d.minutes !== null);
    const avgStay = timed.length
      ? durationLabel(Math.round(timed.reduce((a, d) => a + (d.minutes ?? 0), 0) / timed.length))
      : "—";

    return { present: days.length, punches: punches.length, avgArrival, best, avgStay, timed: timed.length };
  }, [days, presentKeys, punches.length]);

  function deviceInfo(serial: string | null): { name: string; color: string } {
    const d = devices.find((x) => x.serial_no === serial);
    return { name: d?.name ?? serial ?? "Unknown door", color: d?.color ?? "#7A7A72" };
  }

  function downloadCsv() {
    if (!member) return;
    const rows: string[][] = [
      ["Date", "Day", "First In", "Last Out", "Time Inside", "Punches", "Doors"],
      ...[...days].reverse().map((d) => {
        const dow = new Date(`${d.key}T12:00:00Z`).toLocaleDateString("en-PK", { weekday: "long", timeZone: "UTC" });
        const doors = [...new Set(d.punches.map((p) => deviceInfo(p.device_id).name))].join(" / ");
        return [
          d.key, dow,
          d.firstIn ? pktTime(d.firstIn.punch_time) : "",
          d.lastOut ? pktTime(d.lastOut.punch_time) : "",
          d.minutes !== null ? durationLabel(d.minutes) : "",
          String(d.punches.length), doors,
        ];
      }),
    ];
    const csv = rows
      .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
      .join("\n");
    // BOM so Excel opens the file as UTF-8 rather than mangling names.
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance-${member.membership_no}-${ym}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-[#F8F8F6]">
      <DashboardHeader
        title="Attendance by Member"
        subtitle="Search a member, then browse their punch history one month at a time"
      />

      <div className="p-6 space-y-5 max-w-6xl">
        {/* ── Search ──────────────────────────────────────────────── */}
        <Card>
          <div ref={boxRef} className="relative">
            <label className="text-xs font-semibold text-[#4A4A44] block mb-1.5">
              Member name, membership number or phone
            </label>
            <div className="relative">
              <Search className="w-4 h-4 text-[#7A7A72] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={query}
                autoComplete="off"
                placeholder="e.g. Jawad, 0359 or 0300-1234567"
                onChange={(e) => { setQuery(e.target.value); setShowHits(true); }}
                onFocus={() => setShowHits(true)}
                className="w-full pl-9 pr-9 py-2.5 text-sm rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]"
              />
              {query && (
                <button
                  onClick={() => { setQuery(""); setHits([]); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#7A7A72] hover:text-[#1A1A16]"
                  aria-label="Clear search"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {showHits && query.trim().length >= 2 && (
              <div className="absolute z-20 mt-1 w-full bg-white border border-[#E4E4DE] rounded-lg shadow-lg overflow-hidden">
                {searching ? (
                  <div className="px-4 py-3 text-sm text-[#7A7A72]">Searching…</div>
                ) : hits.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-[#7A7A72]">No member matches that.</div>
                ) : (
                  hits.map((h) => (
                    <button
                      key={h.id}
                      onClick={() => { setMember(h); setShowHits(false); setQuery(""); }}
                      className="w-full px-3 py-2.5 flex items-center gap-3 hover:bg-[#FEF0E8] transition-colors text-left"
                    >
                      <MemberAvatar photoUrl={h.photo_url} name={h.full_name} membershipNo={h.membership_no} size={64} memberId={h.id} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-[#1A1A16] truncate">{h.full_name}</span>
                        <span className="block text-xs text-[#7A7A72]">{h.membership_no}</span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </Card>

        {!member ? (
          <Card>
            <div className="py-16 text-center">
              <UserSearch className="w-10 h-10 text-[#C9C9C2] mx-auto mb-3" />
              <p className="text-sm font-semibold text-[#1A1A16]">Pick a member to begin</p>
              <p className="text-xs text-[#7A7A72] mt-1">Start typing a name or membership number above.</p>
            </div>
          </Card>
        ) : (
          <>
            {/* ── Chosen member + month ─────────────────────────────── */}
            <Card>
              <div className="flex flex-wrap items-center gap-4">
                <MemberAvatar photoUrl={member.photo_url} name={member.full_name} membershipNo={member.membership_no} size={96} memberId={member.id} />
                <div className="min-w-0">
                  <Link
                    href={`/dashboard/members/${member.id}`}
                    className="text-base font-bold text-[#1A1A16] hover:text-[#F06418] transition-colors"
                  >
                    {member.full_name}
                  </Link>
                  <div className="text-xs text-[#7A7A72] flex items-center gap-2 mt-0.5">
                    <span>{member.membership_no}</span>
                    {(() => {
                      const { label, variant } = getMemberStatusDisplay(member.status, member.expiry_date);
                      return <Badge variant={variant}>{label}</Badge>;
                    })()}
                  </div>
                </div>

                <div className="ml-auto flex items-center gap-2">
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
                  <Button variant="secondary" size="sm" onClick={downloadCsv} disabled={days.length === 0}>
                    <Download className="w-4 h-4 mr-1" /> CSV
                  </Button>
                </div>
              </div>
            </Card>

            {/* ── Stats ─────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatsCard
                title="Days Present" value={`${stats.present} of ${meta.days}`} icon={CalendarDays}
                iconColor="#F06418" iconBg="#FEF0E8" loading={loading}
              />
              <StatsCard
                title="Total Punches" value={stats.punches} icon={Fingerprint}
                iconColor="#2563EB" iconBg="#EFF6FF" loading={loading}
              />
              <StatsCard
                title="Longest Streak"
                value={stats.best ? `${stats.best} day${stats.best > 1 ? "s" : ""}` : "—"}
                icon={Flame} iconColor="#DC2626" iconBg="#FEF2F2" loading={loading}
              />
              <StatsCard
                title="Usual Arrival" value={stats.avgArrival} icon={Clock}
                iconColor="#059669" iconBg="#ECFDF5" loading={loading}
              />
            </div>

            {/* ── Calendar ──────────────────────────────────────────── */}
            <Card padding={false}>
              <div className="px-5 py-4 border-b border-[#E4E4DE] flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-[#F06418]" />
                <h3 className="text-sm font-semibold text-[#1A1A16]">{meta.label}</h3>
                <span className="ml-auto text-xs text-[#7A7A72]">Orange = came to the gym</span>
              </div>
              <div className="p-5">
                <div className="grid grid-cols-7 gap-1.5">
                  {WEEKDAYS.map((w) => (
                    <div key={w} className="text-[10px] font-bold uppercase tracking-wider text-[#7A7A72] text-center pb-1">
                      {w}
                    </div>
                  ))}
                  {Array.from({ length: meta.firstDow }).map((_, i) => <div key={`pad-${i}`} />)}
                  {Array.from({ length: meta.days }).map((_, i) => {
                    const dayNo  = i + 1;
                    const key    = `${ym}-${String(dayNo).padStart(2, "0")}`;
                    const group  = days.find((d) => d.key === key);
                    const here   = presentKeys.has(key);
                    const isToday = key === todayKey;
                    const future = key > todayKey;
                    return (
                      <div
                        key={key}
                        title={
                          group
                            ? `${group.punches.length} punch${group.punches.length > 1 ? "es" : ""}` +
                              (group.firstIn ? ` — first in ${pktTime(group.firstIn.punch_time)}` : "")
                            : undefined
                        }
                        className={[
                          "aspect-square rounded-lg flex flex-col items-center justify-center text-xs font-semibold border transition-colors",
                          here
                            ? "bg-[#F06418] text-white border-[#F06418]"
                            : future
                              ? "bg-white text-[#C9C9C2] border-[#F0F0EC]"
                              : "bg-[#F8F8F6] text-[#7A7A72] border-[#E4E4DE]",
                          isToday ? "ring-2 ring-offset-1 ring-[#1A1A1A]" : "",
                        ].join(" ")}
                      >
                        {dayNo}
                      </div>
                    );
                  })}
                </div>
              </div>
            </Card>

            {/* ── Day by day ────────────────────────────────────────── */}
            <Card padding={false}>
              <div className="px-5 py-4 border-b border-[#E4E4DE] flex items-center gap-2">
                <Clock className="w-4 h-4 text-[#F06418]" />
                <h3 className="text-sm font-semibold text-[#1A1A16]">Day by day</h3>
                {stats.timed > 0 && (
                  <span className="ml-auto text-xs text-[#7A7A72]">
                    Average stay {stats.avgStay} (over {stats.timed} day{stats.timed > 1 ? "s" : ""} with a check-out)
                  </span>
                )}
              </div>

              {loading ? (
                <div className="px-5 py-10 text-center text-sm text-[#7A7A72]">Loading…</div>
              ) : days.length === 0 ? (
                <div className="px-5 py-12 text-center">
                  <p className="text-sm font-semibold text-[#1A1A16]">No attendance in {meta.label}</p>
                  <p className="text-xs text-[#7A7A72] mt-1">
                    This member did not punch at any door during this month.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-[#E4E4DE]">
                  {days.map((d) => {
                    const dow   = new Date(`${d.key}T12:00:00Z`).toLocaleDateString("en-PK", { weekday: "short", timeZone: "UTC" });
                    const dayNo = Number(d.key.slice(8));
                    return (
                      <div key={d.key} className="px-5 py-3 flex items-start gap-4 hover:bg-[#F8F8F6] transition-colors">
                        <div className="w-12 flex-shrink-0 text-center">
                          <div className="text-lg font-bold text-[#1A1A16] leading-none">{dayNo}</div>
                          <div className="text-[10px] uppercase tracking-wide text-[#7A7A72] mt-0.5">{dow}</div>
                        </div>

                        <div className="flex-1 min-w-0 flex flex-wrap gap-1.5">
                          {d.punches.map((p) => {
                            const dev   = deviceInfo(p.device_id);
                            const isIn  = p.punch_type === "in";
                            const isOut = p.punch_type === "out";
                            return (
                              <span
                                key={p.id}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-white border border-[#E4E4DE]"
                                title={dev.name}
                              >
                                {isIn
                                  ? <LogIn className="w-3 h-3 text-green-600" />
                                  : isOut
                                    ? <LogOut className="w-3 h-3 text-[#F06418]" />
                                    : <Fingerprint className="w-3 h-3 text-[#7A7A72]" />}
                                <span className="text-[#1A1A16]">{pktTime(p.punch_time)}</span>
                                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: dev.color }} />
                              </span>
                            );
                          })}
                        </div>

                        <div className="text-right flex-shrink-0 w-24">
                          {d.minutes !== null ? (
                            <>
                              <div className="text-sm font-semibold text-[#1A1A16]">{durationLabel(d.minutes)}</div>
                              <div className="text-[10px] text-[#7A7A72]">inside</div>
                            </>
                          ) : (
                            <div className="text-[10px] text-[#7A7A72]">no check-out</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
