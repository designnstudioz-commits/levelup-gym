"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { format, subDays, startOfWeek, startOfMonth } from "date-fns";
import {
  CalendarCheck, Users, Wifi, WifiOff, RefreshCw,
  Search, AlertTriangle, ArrowRight, CheckCircle, X,
  Fingerprint, Calendar, Activity, DoorOpen, Settings,
  MapPin, Edit3, Check, Plus,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { StatsCard } from "@/components/ui/StatsCard";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { ViewToggle, type ViewMode } from "@/components/ui/ViewToggle";
import { formatDateTime } from "@/lib/utils";
import Link from "next/link";
import { toast } from "sonner";
import type { Device } from "@/types/database";

type DateRange = "today" | "yesterday" | "week" | "month" | "custom";

interface AttendanceRow {
  id: string;
  punch_time: string;
  punch_type: string | null;
  device_id: string | null;
  verified: boolean;
  member?: {
    id: string; full_name: string; membership_no: string;
    photo_url: string | null; phone: string;
    packages?: { name: string; color: string | null } | null;
  } | null;
  staff?: { id: string; full_name: string; role: string | null } | null;
}

interface UnverifiedRow {
  id: string; device_id: string | null;
  raw_id: string; punch_time: string; resolved: boolean;
}

const DATE_LABELS: Record<DateRange, string> = {
  today: "Today", yesterday: "Yesterday",
  week: "This Week", month: "This Month", custom: "Custom",
};

const DOOR_TYPES = ["Entrance", "Exit", "Gym Floor", "Cardio Room", "MMA Hall", "Locker Room", "Staff Only", "Other"];

const DEVICE_COLORS = [
  { label: "Orange", value: "#F06418" },
  { label: "Blue",   value: "#2563EB" },
  { label: "Green",  value: "#059669" },
  { label: "Red",    value: "#DC2626" },
  { label: "Purple", value: "#7C3AED" },
  { label: "Dark",   value: "#1A1A1A" },
];

export default function AttendancePage() {
  const [records, setRecords]         = useState<AttendanceRow[]>([]);
  const [unverified, setUnverified]   = useState<UnverifiedRow[]>([]);
  const [devices, setDevices]         = useState<Device[]>([]);
  const [loading, setLoading]         = useState(true);
  const [liveMode, setLiveMode]       = useState(true);
  const [viewMode, setViewMode]       = useState<ViewMode>("list");
  const [dateRange, setDateRange]     = useState<DateRange>("today");
  const [customDate, setCustomDate]   = useState("");
  const [search, setSearch]           = useState("");
  const [deviceFilter, setDeviceFilter] = useState<string>("all"); // serial_no or "all"
  const [punchFilter, setPunchFilter]   = useState<"all" | "in" | "out">("all");
  const [resolveModal, setResolveModal] = useState<UnverifiedRow | null>(null);
  const [resolveId, setResolveId]       = useState("");
  const [resolvingSaving, setResolvingSaving] = useState(false);
  const [editDevice, setEditDevice]     = useState<Device | null>(null);
  const [deviceForm, setDeviceForm]     = useState({ name: "", location: "", door_type: "Entrance", color: "#F06418", ip_address: "" });
  const [deviceSaving, setDeviceSaving] = useState(false);
  const realtimeRef = useRef<any>(null);
  const devicePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function getDateBounds() {
    const today = new Date();
    if (dateRange === "today")     return { from: format(today, "yyyy-MM-dd"), to: format(today, "yyyy-MM-dd") };
    if (dateRange === "yesterday") { const y = subDays(today, 1); return { from: format(y, "yyyy-MM-dd"), to: format(y, "yyyy-MM-dd") }; }
    if (dateRange === "week")      return { from: format(startOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd"), to: format(today, "yyyy-MM-dd") };
    if (dateRange === "month")     return { from: format(startOfMonth(today), "yyyy-MM-dd"), to: format(today, "yyyy-MM-dd") };
    if (dateRange === "custom" && customDate) return { from: customDate, to: customDate };
    return { from: format(today, "yyyy-MM-dd"), to: format(today, "yyyy-MM-dd") };
  }

  const fetchData = useCallback(async () => {
    setLoading(true);
    const { from, to } = getDateBounds();
    const supabase = createClient();

    let query = supabase
      .from("attendances")
      .select(`id, punch_time, punch_type, device_id, verified,
        member:members!attendances_member_id_fkey(id, full_name, membership_no, photo_url, phone, packages(name, color)),
        staff:staff_members!attendances_staff_id_fkey(id, full_name, role)`)
      .gte("punch_time", `${from}T00:00:00+05:00`)
      .lte("punch_time", `${to}T23:59:59+05:00`)
      .order("punch_time", { ascending: false })
      .limit(500);

    if (deviceFilter !== "all") query = query.eq("device_id", deviceFilter);

    const [{ data: atts }, { data: unveri }, { data: devs }] = await Promise.all([
      query,
      supabase.from("unverified_attendances").select("*").eq("resolved", false).order("punch_time", { ascending: false }).limit(100),
      supabase.from("devices").select("*").order("name"),
    ]);

    setRecords((atts ?? []) as unknown as AttendanceRow[]);
    setUnverified(unveri ?? []);
    setDevices((devs ?? []) as Device[]);
    setLoading(false);
  }, [dateRange, customDate, deviceFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Realtime subscription — new punches trigger full refresh
  useEffect(() => {
    if (!liveMode) { realtimeRef.current?.unsubscribe(); return; }
    const supabase = createClient();
    realtimeRef.current = supabase.channel("attendance-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "attendances" }, () => fetchData())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "unverified_attendances" }, () => fetchData())
      .subscribe();
    return () => { realtimeRef.current?.unsubscribe(); };
  }, [liveMode, fetchData]);

  // Poll devices every 30s to keep last_seen + online status current
  const fetchDevices = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.from("devices").select("*").order("name");
    if (data) setDevices(data as Device[]);
  }, []);

  useEffect(() => {
    devicePollRef.current = setInterval(fetchDevices, 30_000);
    return () => { if (devicePollRef.current) clearInterval(devicePollRef.current); };
  }, [fetchDevices]);

  // Filtered records
  const filtered = records.filter((r) => {
    if (punchFilter !== "all" && r.punch_type !== punchFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.member?.full_name.toLowerCase().includes(q) ||
      r.member?.membership_no.toLowerCase().includes(q) ||
      r.member?.phone.includes(q) ||
      r.staff?.full_name.toLowerCase().includes(q)
    );
  });

  // Per-device stats
  const deviceStats = devices.map((d) => ({
    device: d,
    count: records.filter((r) => r.device_id === d.serial_no).length,
    online: d.last_seen ? (Date.now() - new Date(d.last_seen).getTime()) < 2 * 60 * 1000 : false,
  }));

  const uniqueMembers = new Set(records.filter((r) => r.member?.id).map((r) => r.member!.id)).size;
  const hourCounts = records.reduce((acc, r) => {
    const h = new Date(r.punch_time).getHours();
    acc[h] = (acc[h] || 0) + 1;
    return acc;
  }, {} as Record<number, number>);
  const peakHour = Object.entries(hourCounts).sort(([, a], [, b]) => b - a)[0];
  const peakLabel = peakHour ? `${peakHour[0]}:00 – ${(Number(peakHour[0]) + 1).toString().padStart(2, "0")}:00` : "—";

  // Helper: get device info by serial
  function getDevice(serial: string | null): Device | undefined {
    return devices.find((d) => d.serial_no === serial);
  }

  // Save device name/location
  async function saveDevice() {
    if (!editDevice) return;
    setDeviceSaving(true);
    const supabase = createClient();
    await supabase.from("devices").update({
      name: deviceForm.name.trim() || editDevice.serial_no,
      location: deviceForm.location || null,
      door_type: deviceForm.door_type,
      color: deviceForm.color,
      ip_address: deviceForm.ip_address || null,
    }).eq("id", editDevice.id);
    await supabase.from("activity_logs").insert({
      action: "updated_device", entity_type: "device",
      description: `Updated device "${deviceForm.name}" (${editDevice.serial_no})`,
    });
    toast.success("Device updated");
    setEditDevice(null);
    setDeviceSaving(false);
    fetchData();
  }

  async function deleteDevice() {
    if (!editDevice) return;
    if (!confirm(`Remove device "${editDevice.name}" (${editDevice.serial_no})? It will re-appear if the machine reconnects.`)) return;
    setDeviceSaving(true);
    const supabase = createClient();
    await supabase.from("devices").delete().eq("id", editDevice.id);
    toast.success("Device removed");
    setEditDevice(null);
    setDeviceSaving(false);
    fetchData();
  }

  async function handleResolve() {
    if (!resolveModal || !resolveId.trim()) return;
    setResolvingSaving(true);
    const supabase = createClient();

    // Try membership number first (exact match)
    let { data: member } = await supabase
      .from("members").select("id, device_user_id, full_name")
      .eq("membership_no", resolveId.trim().toUpperCase())
      .is("deleted_at", null).maybeSingle();

    // Fall back to name search
    if (!member) {
      const { data: byName } = await supabase
        .from("members").select("id, device_user_id, full_name")
        .ilike("full_name", `%${resolveId.trim()}%`)
        .is("deleted_at", null);
      if (byName && byName.length === 1) {
        member = byName[0];
      } else if (byName && byName.length > 1) {
        toast.error(`Found ${byName.length} matches — use the membership number (LUF-YYYY-NNNN) to be specific`);
        setResolvingSaving(false);
        return;
      }
    }

    if (!member) { toast.error("Member not found — check the membership number or name"); setResolvingSaving(false); return; }
    if (!member.device_user_id) {
      await supabase.from("members").update({ device_user_id: resolveModal.raw_id, thumb_registered: true }).eq("id", member.id);
    }
    await supabase.from("attendances").insert({
      member_id: member.id, device_id: resolveModal.device_id,
      punch_time: resolveModal.punch_time, punch_type: "in", verified: true,
    });
    await supabase.from("unverified_attendances").update({ resolved: true, resolved_at: new Date().toISOString() }).eq("id", resolveModal.id);
    toast.success("Punch identified and linked");
    setResolveModal(null); setResolveId(""); setResolvingSaving(false);
    fetchData();
  }

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title="Attendance"
        subtitle={`${devices.length} device${devices.length !== 1 ? "s" : ""} · SpeedFace V5L`}
        action={
          <div className="flex items-center gap-2">
            <button onClick={() => setLiveMode(!liveMode)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${liveMode ? "bg-green-50 border-green-300 text-green-700" : "bg-white border-[#E4E4DE] text-[#7A7A72]"}`}
            >
              {liveMode ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
              {liveMode ? "Live" : "Paused"}
            </button>
            <Button variant="ghost" size="sm" onClick={fetchData}><RefreshCw className="w-4 h-4" /></Button>
          </div>
        }
      />

      <div className="flex-1 p-6 space-y-5">

        {/* ── Device status cards (one per machine) ─────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {devices.length === 0 ? (
            <div className="col-span-3 flex items-center gap-3 bg-yellow-50 border border-yellow-200 rounded-xl px-5 py-4 text-sm text-yellow-800">
              <AlertTriangle className="w-5 h-5 flex-shrink-0" />
              <div>
                <p className="font-semibold">No devices connected yet</p>
                <p className="text-xs mt-0.5">Configure each SpeedFace V5L to push to <code className="bg-yellow-100 px-1 rounded">/api/attendance/push</code>. All 3 machines use the same URL — they are identified by their serial number.</p>
              </div>
            </div>
          ) : (
            devices.map((d) => {
              const stat = deviceStats.find((s) => s.device.id === d.id);
              const online = stat?.online ?? false;
              const accent = d.color ?? "#F06418";
              const isFiltered = deviceFilter === d.serial_no;

              return (
                <div
                  key={d.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setDeviceFilter(isFiltered ? "all" : d.serial_no)}
                  onKeyDown={(e) => e.key === "Enter" && setDeviceFilter(isFiltered ? "all" : d.serial_no)}
                  className={`text-left rounded-xl border-2 p-4 transition-all cursor-pointer ${isFiltered ? "border-[#F06418] bg-[#FEF0E8]" : "border-[#E4E4DE] bg-white hover:border-[#F06418]"}`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: accent + "20" }}>
                        <DoorOpen className="w-5 h-5" style={{ color: accent }} />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-[#1A1A16]">{d.name}</p>
                        {d.door_type && (
                          <span className="text-[10px] font-semibold text-[#7A7A72] uppercase tracking-wide">{d.door_type}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className={`w-2 h-2 rounded-full ${online ? "bg-green-500 animate-pulse" : "bg-gray-300"}`} />
                      <span className={`text-[10px] font-semibold ${online ? "text-green-700" : "text-[#7A7A72]"}`}>
                        {online ? "Online" : "Offline"}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-2xl font-bold" style={{ color: accent }}>{stat?.count ?? 0}</p>
                      <p className="text-xs text-[#7A7A72]">punches ({DATE_LABELS[dateRange].toLowerCase()})</p>
                    </div>
                    <div className="text-right">
                      {d.location && (
                        <p className="text-xs text-[#7A7A72] flex items-center gap-0.5 justify-end">
                          <MapPin className="w-3 h-3" /> {d.location}
                        </p>
                      )}
                      <p className="text-[10px] text-[#7A7A72] font-mono mt-0.5">{d.serial_no}</p>
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-[#E4E4DE] flex items-center justify-between">
                    <span className={`text-xs font-medium ${isFiltered ? "text-[#F06418]" : "text-[#7A7A72]"}`}>
                      {isFiltered ? "Filtering by this device ✓" : "Click to filter"}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeviceForm({ name: d.name, location: d.location ?? "", door_type: d.door_type ?? "Entrance", color: d.color ?? "#F06418", ip_address: d.ip_address ?? "" }); setEditDevice(d); }}
                      className="p-1 rounded-lg text-[#7A7A72] hover:text-[#F06418] hover:bg-white transition-colors"
                    >
                      <Settings className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}

          {/* Unverified alert */}
          {unverified.length > 0 && (
            <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-4 text-sm text-red-800">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">{unverified.length} unidentified punch{unverified.length !== 1 ? "es" : ""}</p>
                <p className="text-xs mt-0.5">Scroll down to identify these members</p>
              </div>
            </div>
          )}
        </div>

        {/* ── Stats ──────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard
            title={deviceFilter !== "all" ? `Punches (${getDevice(deviceFilter)?.name ?? deviceFilter})` : `Total Punches (${DATE_LABELS[dateRange]})`}
            value={records.filter((r) => r.punch_type === "in").length}
            icon={CalendarCheck} iconColor="text-[#F06418]" iconBg="bg-[#FEF0E8]"
          />
          <StatsCard title="Unique Members" value={uniqueMembers} icon={Users} iconColor="text-blue-600" iconBg="bg-blue-50" />
          <StatsCard title="Peak Hour" value={peakLabel} icon={Activity} iconColor="text-purple-600" iconBg="bg-purple-50" />
          <StatsCard title="Total Records" value={records.length} icon={CheckCircle} iconColor="text-green-600" iconBg="bg-green-50" />
        </div>

        {/* ── Filter bar ─────────────────────────────────────────── */}
        <div className="bg-white border border-[#E4E4DE] rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            {/* Date range */}
            <div className="flex bg-[#F8F8F6] border border-[#E4E4DE] rounded-lg p-0.5 gap-0.5">
              {(["today", "yesterday", "week", "month"] as DateRange[]).map((d) => (
                <button key={d} onClick={() => setDateRange(d)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors capitalize ${dateRange === d ? "bg-[#F06418] text-white" : "text-[#4A4A44] hover:bg-white"}`}
                >
                  {DATE_LABELS[d]}
                </button>
              ))}
              <button onClick={() => setDateRange("custom")}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1 ${dateRange === "custom" ? "bg-[#F06418] text-white" : "text-[#4A4A44] hover:bg-white"}`}
              >
                <Calendar className="w-3 h-3" /> Custom
              </button>
            </div>

            {dateRange === "custom" && (
              <input type="date" value={customDate} onChange={(e) => setCustomDate(e.target.value)}
                className="text-xs px-3 py-1.5 rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]"
              />
            )}

            <div className="flex-1 min-w-40 max-w-sm relative">
              <Search className="w-4 h-4 text-[#7A7A72] absolute left-3 top-1/2 -translate-y-1/2" />
              <input type="text" placeholder="Search member name, ID, phone..." value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]"
              />
            </div>

            <ViewToggle value={viewMode} onChange={setViewMode} options={["list", "compact"]} />
            <Button variant="ghost" size="sm" onClick={fetchData}><RefreshCw className="w-4 h-4" /></Button>
          </div>

          {/* Row 2 */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Punch type */}
            <div className="flex bg-[#F8F8F6] border border-[#E4E4DE] rounded-lg p-0.5 gap-0.5">
              {([["all", "All Punches"], ["in", "Check-in ↓"], ["out", "Check-out ↑"]] as const).map(([k, label]) => (
                <button key={k} onClick={() => setPunchFilter(k)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${punchFilter === k ? "bg-[#F06418] text-white" : "text-[#4A4A44] hover:bg-white"}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Device filter chips */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[#7A7A72]">Device:</span>
              <button
                onClick={() => setDeviceFilter("all")}
                className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${deviceFilter === "all" ? "bg-[#F06418] text-white border-[#F06418]" : "bg-white text-[#4A4A44] border-[#E4E4DE] hover:border-[#F06418]"}`}
              >
                All ({devices.length})
              </button>
              {devices.map((d) => {
                const accent = d.color ?? "#F06418";
                const active = deviceFilter === d.serial_no;
                return (
                  <button key={d.id} onClick={() => setDeviceFilter(active ? "all" : d.serial_no)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors flex items-center gap-1.5 ${active ? "text-white border-transparent" : "bg-white text-[#4A4A44] border-[#E4E4DE] hover:border-[#F06418]"}`}
                    style={active ? { backgroundColor: accent, borderColor: accent } : {}}
                  >
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: active ? "white" : accent }} />
                    {d.name}
                  </button>
                );
              })}
            </div>

            {liveMode && dateRange === "today" && (
              <div className="flex items-center gap-1.5 text-xs text-green-700 font-medium ml-auto">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                Live updates
              </div>
            )}

            <span className={`text-xs text-[#7A7A72] ${liveMode && dateRange === "today" ? "" : "ml-auto"}`}>
              {filtered.length} record{filtered.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {/* ── Records ────────────────────────────────────────────── */}
        {loading ? (
          <div className="py-16 text-center">
            <RefreshCw className="w-6 h-6 text-[#7A7A72] animate-spin mx-auto mb-2" />
            <p className="text-sm text-[#7A7A72]">Loading attendance...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <div className="w-14 h-14 bg-[#FEF0E8] rounded-2xl flex items-center justify-center mx-auto mb-4">
              <CalendarCheck className="w-7 h-7 text-[#F06418]" />
            </div>
            <p className="text-base font-semibold text-[#1A1A16]">
              No records {deviceFilter !== "all" ? `from ${getDevice(deviceFilter)?.name ?? deviceFilter}` : ""} {DATE_LABELS[dateRange].toLowerCase()}
            </p>
            {deviceFilter !== "all" && (
              <button onClick={() => setDeviceFilter("all")} className="mt-2 text-sm text-[#F06418] hover:underline">
                Show all devices
              </button>
            )}
          </div>
        ) : viewMode === "list" ? (
          <AttendanceTable records={filtered} getDevice={getDevice} />
        ) : (
          <AttendanceCompact records={filtered} getDevice={getDevice} />
        )}

        {/* ── Unverified punches ─────────────────────────────────── */}
        {unverified.length > 0 && (
          <Card padding={false}>
            <div className="px-5 py-4 border-b border-[#E4E4DE] flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              <h3 className="text-sm font-semibold text-[#1A1A16]">Unidentified Punches</h3>
              <span className="ml-auto text-xs text-[#7A7A72]">{unverified.length} pending</span>
            </div>
            <div className="divide-y divide-[#E4E4DE]">
              {unverified.slice(0, 20).map((u) => {
                const dev = getDevice(u.device_id);
                return (
                  <div key={u.id} className="px-5 py-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {dev && (
                        <div className="w-2 h-8 rounded-full flex-shrink-0" style={{ backgroundColor: dev.color ?? "#F06418" }} />
                      )}
                      <div>
                        <p className="text-sm font-semibold text-[#1A1A16]">
                          Device User ID: <code className="bg-[#F8F8F6] px-1.5 py-0.5 rounded text-xs">{u.raw_id}</code>
                        </p>
                        <p className="text-xs text-[#7A7A72]">
                          {formatDateTime(u.punch_time)}
                          {dev && <span className="ml-2 font-medium" style={{ color: dev.color ?? "#F06418" }}>· {dev.name}</span>}
                        </p>
                      </div>
                    </div>
                    <button onClick={() => { setResolveModal(u); setResolveId(""); }}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#FEF0E8] text-[#F06418] border border-[#FDDCC8] hover:bg-[#F06418] hover:text-white transition-colors flex-shrink-0"
                    >
                      Identify Member
                    </button>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* ── Setup guide ────────────────────────────────────────── */}
        <Card>
          <h3 className="text-sm font-semibold text-[#1A1A16] mb-4 flex items-center gap-2">
            <DoorOpen className="w-4 h-4 text-[#F06418]" /> Multi-Device Setup (3 SpeedFace V5L machines)
          </h3>
          <div className="bg-[#F8F8F6] border border-[#E4E4DE] rounded-lg px-4 py-3 mb-4">
            <p className="text-sm font-semibold text-[#1A1A16] mb-1">All 3 machines use the EXACT same URL:</p>
            <code className="text-sm text-[#F06418] break-all">https://your-domain.com/api/attendance/push</code>
            <p className="text-xs text-[#7A7A72] mt-1.5">Each machine is automatically identified by its serial number (sn). No extra configuration needed per device.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {["Machine 1 — Main Door", "Machine 2 — Gym Floor", "Machine 3 — Cardio Room"].map((label, i) => (
              <div key={i} className="bg-white border border-[#E4E4DE] rounded-lg p-3">
                <p className="text-xs font-bold text-[#1A1A16] mb-2">{label}</p>
                <ol className="space-y-1 text-xs text-[#4A4A44]">
                  <li>1. Menu → COMM. → ADMS</li>
                  <li>2. Server Address → your domain</li>
                  <li>3. Port → 443 (HTTPS)</li>
                  <li>4. Enable ADMS → Save</li>
                  <li>5. First punch → appears here automatically</li>
                </ol>
              </div>
            ))}
          </div>
          <p className="text-xs text-[#7A7A72] mt-3">
            After each device connects, click its ⚙ icon above to give it a friendly name like "Main Entrance" and set its location.
          </p>
        </Card>
      </div>

      {/* ── Edit Device Modal ─────────────────────────────────────── */}
      <Modal open={!!editDevice} onClose={() => setEditDevice(null)} title={`Configure — ${editDevice?.serial_no}`} size="md">
        {editDevice && (
          <div className="p-5 space-y-4">
            <div className="bg-[#F8F8F6] rounded-lg px-4 py-3 text-xs text-[#7A7A72] space-y-1">
              <p>Serial: <span className="font-mono font-semibold text-[#1A1A16]">{editDevice.serial_no}</span></p>
              <p>Last seen: <span className="text-[#1A1A16]">{editDevice.last_seen ? formatDateTime(editDevice.last_seen) : "Never"}</span></p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Input label="Device Name" placeholder="e.g. Main Entrance"
                value={deviceForm.name} onChange={(e) => setDeviceForm({ ...deviceForm, name: e.target.value })} />
              <Input label="Location" placeholder="e.g. Ground Floor"
                value={deviceForm.location} onChange={(e) => setDeviceForm({ ...deviceForm, location: e.target.value })} />
              <Select label="Door Type" value={deviceForm.door_type}
                onChange={(e) => setDeviceForm({ ...deviceForm, door_type: e.target.value })}>
                {DOOR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
              <Input label="IP Address (optional)" placeholder="192.168.1.101"
                value={deviceForm.ip_address} onChange={(e) => setDeviceForm({ ...deviceForm, ip_address: e.target.value })} />
            </div>

            <div>
              <label className="text-sm font-medium text-[#1A1A16] block mb-2">Color (for visual identification)</label>
              <div className="flex gap-2">
                {DEVICE_COLORS.map((c) => (
                  <button key={c.value} type="button" onClick={() => setDeviceForm({ ...deviceForm, color: c.value })}
                    title={c.label}
                    className={`w-8 h-8 rounded-full border-2 transition-all ${deviceForm.color === c.value ? "border-[#1A1A1A] scale-110" : "border-transparent hover:scale-105"}`}
                    style={{ backgroundColor: c.value }}
                  />
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setEditDevice(null)} className="flex-1">Cancel</Button>
              <Button onClick={saveDevice} loading={deviceSaving} className="flex-1">
                <Check className="w-4 h-4" /> Save Device
              </Button>
            </div>
            <button
              onClick={deleteDevice}
              className="w-full mt-2 text-xs text-red-500 hover:text-red-700 hover:underline transition-colors"
            >
              Remove this device
            </button>
          </div>
        )}
      </Modal>

      {/* ── Resolve Unverified Modal ──────────────────────────────── */}
      <Modal open={!!resolveModal} onClose={() => setResolveModal(null)} title="Identify Unverified Punch" size="sm">
        {resolveModal && (
          <div className="p-5 space-y-4">
            <div className="bg-[#F8F8F6] rounded-lg p-3 text-sm space-y-1">
              <p>Device User ID: <code className="bg-white px-1.5 py-0.5 rounded border border-[#E4E4DE] text-xs font-mono">{resolveModal.raw_id}</code></p>
              <p className="text-xs text-[#7A7A72]">{formatDateTime(resolveModal.punch_time)}</p>
              {getDevice(resolveModal.device_id) && (
                <p className="text-xs font-medium" style={{ color: getDevice(resolveModal.device_id)!.color ?? "#F06418" }}>
                  From: {getDevice(resolveModal.device_id)!.name}
                </p>
              )}
            </div>
            <Input label="Membership No or Member Name" placeholder="LUF-2026-0001 or member name" required
              value={resolveId} onChange={(e) => setResolveId(e.target.value)} />
            <p className="text-xs text-[#7A7A72]">
              This permanently links Device ID <strong>{resolveModal.raw_id}</strong> to the member — all future punches from this ID will auto-identify.
            </p>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setResolveModal(null)} className="flex-1">Cancel</Button>
              <Button onClick={handleResolve} loading={resolvingSaving} className="flex-1">Link & Identify</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ── Attendance Table ──────────────────────────────────────────────────
function AttendanceTable({ records, getDevice }: { records: AttendanceRow[]; getDevice: (s: string | null) => Device | undefined }) {
  return (
    <div className="bg-white border border-[#E4E4DE] rounded-xl overflow-hidden">
      <table className="w-full">
        <thead className="bg-[#F8F8F6] border-b border-[#E4E4DE]">
          <tr>
            <th className="text-left text-xs font-semibold text-[#7A7A72] px-5 py-3">Member / Staff</th>
            <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Time (PKT)</th>
            <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Type</th>
            <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Package</th>
            <th className="text-left text-xs font-semibold text-[#7A7A72] px-4 py-3">Device / Door</th>
            <th className="px-5 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-[#E4E4DE]">
          {records.map((r) => {
            const person = r.member ?? r.staff;
            const isIn = r.punch_type === "in";
            const pkg = (r.member as any)?.packages;
            const dev = getDevice(r.device_id);

            return (
              <tr key={r.id} className="hover:bg-[#F8F8F6] transition-colors">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-[#FEF0E8] flex items-center justify-center flex-shrink-0 overflow-hidden">
                      {r.member?.photo_url ? (
                        <img src={r.member.photo_url} alt="" className="w-8 h-8 object-cover" />
                      ) : (
                        <span className="text-[#F06418] text-xs font-bold">{person?.full_name?.charAt(0) ?? "?"}</span>
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[#1A1A16]">{person?.full_name ?? "Unknown"}</p>
                      <p className="text-xs text-[#7A7A72]">
                        {r.member?.membership_no ?? (r.staff ? `Staff · ${(r.staff as any).role}` : "—")}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-[#1A1A16] font-medium">{formatDateTime(r.punch_time)}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center text-xs font-semibold px-2 py-1 rounded-full border ${isIn ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"}`}>
                    {isIn ? "↓ In" : "↑ Out"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {pkg ? (
                    <span className="text-xs font-medium text-[#4A4A44] flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: pkg.color ?? "#F06418" }} />
                      {pkg.name}
                    </span>
                  ) : <span className="text-[#7A7A72] text-xs">—</span>}
                </td>
                <td className="px-4 py-3">
                  {dev ? (
                    <span className="text-xs font-medium flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: dev.color ?? "#F06418" }} />
                      <span style={{ color: dev.color ?? "#F06418" }}>{dev.name}</span>
                      {dev.door_type && <span className="text-[#7A7A72]">· {dev.door_type}</span>}
                    </span>
                  ) : (
                    <span className="text-xs font-mono text-[#7A7A72]">{r.device_id ?? "—"}</span>
                  )}
                </td>
                <td className="px-5 py-3">
                  {r.member && (
                    <Link href={`/dashboard/members/${r.member.id}`}>
                      <button className="p-1.5 rounded-lg text-[#7A7A72] hover:text-[#F06418] hover:bg-[#FEF0E8] transition-colors">
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </Link>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Compact View ──────────────────────────────────────────────────────
function AttendanceCompact({ records, getDevice }: { records: AttendanceRow[]; getDevice: (s: string | null) => Device | undefined }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
      {records.map((r) => {
        const person = r.member ?? r.staff;
        const isIn = r.punch_type === "in";
        const dev = getDevice(r.device_id);
        const accent = dev?.color ?? "#F06418";
        const d = new Date(r.punch_time);
        const timeStr = d.toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Karachi" });

        return (
          <div key={r.id} className="bg-white border rounded-xl p-3 overflow-hidden relative" style={{ borderColor: isIn ? "#bbf7d0" : "#fecaca" }}>
            {/* Device color stripe */}
            <div className="absolute top-0 left-0 w-1 h-full rounded-l-xl" style={{ backgroundColor: accent }} />
            <div className="pl-2">
              <div className="flex items-center gap-2 mb-1.5">
                <div className="w-7 h-7 rounded-full bg-[#FEF0E8] flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {r.member?.photo_url ? (
                    <img src={r.member.photo_url} alt="" className="w-7 h-7 object-cover" />
                  ) : (
                    <span className="text-[#F06418] text-[10px] font-bold">{person?.full_name?.charAt(0) ?? "?"}</span>
                  )}
                </div>
                <p className="text-xs font-semibold text-[#1A1A16] truncate">{person?.full_name ?? "Unknown"}</p>
              </div>
              <div className="flex items-center justify-between">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isIn ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                  {isIn ? "↓ IN" : "↑ OUT"}
                </span>
                <span className="text-xs font-mono text-[#4A4A44]">{timeStr}</span>
              </div>
              {dev && (
                <p className="text-[10px] text-[#7A7A72] mt-1 truncate" style={{ color: accent }}>{dev.name}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
