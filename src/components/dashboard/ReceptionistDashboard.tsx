"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format, subDays } from "date-fns";
import { toast } from "sonner";
import {
  Search, AlertTriangle, Clock, UserPlus, Bell,
  CheckCircle2, MessageSquare, Plus, X,
  CalendarCheck, ClipboardList, Cake, Zap, Wifi, ListChecks,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useCurrentUser } from "@/contexts/CurrentUserContext";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { formatDate, formatPKR, daysUntilExpiry, isDeviceOnline, safeDateValue } from "@/lib/utils";

// ── Shared types ────────────────────────────────────────────────────
interface MemberLite {
  id: string;
  full_name: string;
  phone: string;
  membership_no: string;
  photo_url: string | null;
  status: string;
  expiry_date: string | null;
  trainer_id: string | null;
  dob: string | null;
  emergency_name: string | null;
  emergency_phone: string | null;
  membership_start_date: string | null;
  joining_date: string | null;
  monthly_fee: number | null;
  packages?: { name: string; monthly_fee: number } | null;
  trainer?: { full_name: string } | null;
}

interface ReminderInfo {
  status: "prepared" | "queued" | "sent" | "failed";
  at: string;
}

const REMINDER_TYPE_EXPIRY = "membership_expiry";
const REMINDER_TYPE_BALANCE = "payment_followup";
const REMINDER_TYPE_INACTIVE = "inactivity";
const REMINDER_TYPE_BIRTHDAY = "birthday";

function daysSince(dateStr: string | null): number | null {
  const d = daysUntilExpiry(dateStr);
  return d === null ? null : -d;
}

/** Inserts a sms_log row with status="prepared" — NOT an actual send. No
 *  SMS/WhatsApp/email gateway exists yet; this only creates a real,
 *  queryable record ("prepared, not sent") so the communication layer can
 *  be wired in later without changing this call site. */
async function prepareReminder(params: {
  member: { phone: string; full_name: string };
  type: string;
  message: string;
  sentBy: string | null;
}) {
  const supabase = createClient();
  const { error } = await supabase.from("sms_log").insert({
    recipients: [params.member.phone],
    message: params.message,
    type: params.type,
    sent_by: params.sentBy,
    status: "prepared",
  });
  if (error) throw error;
}

export default function ReceptionistDashboard({ header }: { header: React.ReactNode }) {
  const currentUser = useCurrentUser();
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const [members, setMembers] = useState<MemberLite[]>([]);
  const [balanceRows, setBalanceRows] = useState<{ id: string; member_id: string; balance_due: number; balance_due_date: string | null }[]>([]);
  const [lastVisitByMember, setLastVisitByMember] = useState<Map<string, string>>(new Map());
  const [reminderByPhone, setReminderByPhone] = useState<Map<string, ReminderInfo>>(new Map());
  const [pendingSubmissions, setPendingSubmissions] = useState<any[]>([]);
  const [unverifiedCount, setUnverifiedCount] = useState(0);
  const [devicesOnline, setDevicesOnline] = useState(0);
  const [devicesTotal, setDevicesTotal] = useState(0);
  const [todayWalkIns, setTodayWalkIns] = useState<any[]>([]);
  const [todayCheckins, setTodayCheckins] = useState<{ member_id: string; punch_time: string }[]>([]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const today = format(new Date(), "yyyy-MM-dd");
    const thirtyDaysAgo = format(subDays(new Date(), 30), "yyyy-MM-dd");

    const [
      { data: activeMembers },
      { data: balances },
      { data: recentAttendance },
      { data: recentReminders },
      { data: subs },
      { count: unverified },
      { data: devices },
      { data: walkIns },
    ] = await Promise.all([
      supabase.from("members")
        .select("id, full_name, phone, membership_no, photo_url, status, expiry_date, trainer_id, dob, emergency_name, emergency_phone, membership_start_date, joining_date, monthly_fee, packages(name, monthly_fee), trainer:staff_members!members_trainer_id_fkey(full_name)")
        .eq("status", "active").is("deleted_at", null),
      supabase.from("fee_payments").select("id, member_id, balance_due, balance_due_date").is("deleted_at", null).gt("balance_due", 0),
      supabase.from("attendances").select("member_id, punch_time").gte("punch_time", `${thirtyDaysAgo}T00:00:00`).not("member_id", "is", null),
      supabase.from("sms_log").select("recipients, type, status, sent_at, created_at").gte("created_at", `${thirtyDaysAgo}T00:00:00`).not("recipients", "is", null),
      supabase.from("submissions").select("id, full_name, status, created_at, phone, emergency_name, package_id, trainer_id").eq("status", "pending").is("deleted_at", null).order("created_at", { ascending: false }),
      supabase.from("unverified_attendances").select("*", { count: "exact", head: true }).eq("resolved", false),
      supabase.from("devices").select("id, last_seen"),
      supabase.from("daily_members").select("id, full_name, phone, fee_paid, visit_date, converted_to_member_id, purpose").is("deleted_at", null).eq("visit_date", today),
    ]);

    setMembers((activeMembers ?? []) as unknown as MemberLite[]);
    setBalanceRows((balances ?? []) as any);

    // Last visit per member — same "boundary map" shape used elsewhere in
    // the app for unpaid-since-cycle-start, reused here for inactivity.
    const lastVisit = new Map<string, string>();
    const todayPunches: { member_id: string; punch_time: string }[] = [];
    for (const a of recentAttendance ?? []) {
      if (!a.member_id) continue;
      const cur = lastVisit.get(a.member_id);
      if (!cur || a.punch_time > cur) lastVisit.set(a.member_id, a.punch_time);
      if (a.punch_time.slice(0, 10) === today) todayPunches.push({ member_id: a.member_id, punch_time: a.punch_time });
    }
    setLastVisitByMember(lastVisit);
    setTodayCheckins(todayPunches.sort((a, b) => b.punch_time.localeCompare(a.punch_time)));

    // Reminder status per phone — most recent sms_log row per recipient.
    const reminderMap = new Map<string, ReminderInfo>();
    for (const r of (recentReminders ?? []) as any[]) {
      for (const phone of r.recipients ?? []) {
        const existing = reminderMap.get(phone);
        const at = r.sent_at ?? r.created_at;
        if (!existing || at > existing.at) reminderMap.set(phone, { status: r.status, at });
      }
    }
    setReminderByPhone(reminderMap);

    setPendingSubmissions(subs ?? []);
    setUnverifiedCount(unverified ?? 0);
    setDevicesTotal(devices?.length ?? 0);
    setDevicesOnline((devices ?? []).filter((d) => isDeviceOnline(d.last_seen)).length);
    setTodayWalkIns(walkIns ?? []);

    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll, refreshKey]);
  const refresh = () => setRefreshKey((k) => k + 1);

  // ── Derived buckets (all client-side, over the one bulk active-members
  // fetch — cheaper than N separate narrow queries for what are really
  // just different filters over the same roster) ──────────────────────
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const in3DaysStr = format(subDays(new Date(), -3), "yyyy-MM-dd");
  const in7DaysStr = format(subDays(new Date(), -7), "yyyy-MM-dd");

  const balanceByMember = useMemo(() => {
    const m = new Map<string, { total: number; earliestDue: string | null }>();
    for (const b of balanceRows) {
      const cur = m.get(b.member_id) ?? { total: 0, earliestDue: null };
      cur.total += b.balance_due;
      if (b.balance_due_date && (!cur.earliestDue || b.balance_due_date < cur.earliestDue)) cur.earliestDue = b.balance_due_date;
      m.set(b.member_id, cur);
    }
    return m;
  }, [balanceRows]);

  const expiringToday = members.filter((m) => m.expiry_date === todayStr);
  const expiring3 = members.filter((m) => m.expiry_date && m.expiry_date > todayStr && m.expiry_date <= in3DaysStr);
  const expiring7 = members.filter((m) => m.expiry_date && m.expiry_date > in3DaysStr && m.expiry_date <= in7DaysStr);
  const alreadyExpired = members.filter((m) => m.expiry_date && m.expiry_date < todayStr);

  const paymentFollowUp = members.filter((m) => (balanceByMember.get(m.id)?.total ?? 0) > 0);

  const goneQuietDefault = members.filter((m) => {
    const lv = lastVisitByMember.get(m.id);
    const days = lv ? daysSince(lv.slice(0, 10)) : null;
    return days === null || days >= 7;
  });

  const incompleteProfiles = members.filter((m) => !m.photo_url || !m.emergency_name || !m.emergency_phone);

  const incompleteSubmissions = pendingSubmissions.filter((s) => !s.emergency_name || !s.package_id);

  const birthdaysToday = members.filter((m) => {
    if (!m.dob) return false;
    const d = new Date(m.dob + "T12:00:00");
    const t = new Date();
    return d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
  });

  const offlineDevices = devicesTotal - devicesOnline;

  return (
    <div className="flex flex-col flex-1">
      {header}
      <div className="flex-1 p-6 space-y-6">
        <GlobalSearch balanceByMember={balanceByMember} lastVisitByMember={lastVisitByMember} />

        <QuickActions />

        <NeedsAttention
          loading={loading}
          expiringToday={expiringToday.length}
          expiring3={expiring3.length}
          expiring7={expiring7.length}
          paymentFollowUp={paymentFollowUp.length}
          goneQuiet={goneQuietDefault.length}
          pendingSubmissions={pendingSubmissions.length}
          incompleteProfiles={incompleteProfiles.length}
          unverifiedCount={unverifiedCount}
          offlineDevices={offlineDevices}
        />

        {/* ── Main work area ── */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
          <div className="xl:col-span-2 space-y-6">
            <ExpiringMembers
              loading={loading}
              expiringToday={expiringToday} expiring3={expiring3} expiring7={expiring7} alreadyExpired={alreadyExpired}
              balanceByMember={balanceByMember} lastVisitByMember={lastVisitByMember}
              reminderByPhone={reminderByPhone} currentUserId={currentUser?.id ?? null}
              onReminderSent={refresh}
            />
            <PaymentFollowUp
              loading={loading} members={paymentFollowUp} balanceByMember={balanceByMember}
              reminderByPhone={reminderByPhone} currentUserId={currentUser?.id ?? null} onReminderSent={refresh}
            />
          </div>
          <div className="space-y-6">
            <MyTasks currentUserId={currentUser?.id ?? null} refreshKey={refreshKey} />
            <GoneQuiet loading={loading} members={members} lastVisitByMember={lastVisitByMember}
              reminderByPhone={reminderByPhone} currentUserId={currentUser?.id ?? null} onReminderSent={refresh} />
          </div>
        </div>

        {/* ── Secondary area ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <TodayCheckins loading={loading} checkins={todayCheckins} members={members} balanceByMember={balanceByMember} lastVisitByMember={lastVisitByMember} />
          <RegistrationQueue loading={loading} submissions={pendingSubmissions} incompleteIds={new Set(incompleteSubmissions.map((s) => s.id))} canApprove={currentUser?.role === "owner" || currentUser?.role === "manager"} />
          <AttendanceIssues loading={loading} unverifiedCount={unverifiedCount} devicesOnline={devicesOnline} devicesTotal={devicesTotal} />
        </div>

        {/* ── Low priority ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <IncompleteProfiles loading={loading} members={incompleteProfiles} />
          <TodayWalkIns loading={loading} walkIns={todayWalkIns} />
          <Birthdays loading={loading} members={birthdaysToday} reminderByPhone={reminderByPhone} currentUserId={currentUser?.id ?? null} onReminderSent={refresh} />
        </div>

        <EndOfDaySummary
          followUps={paymentFollowUp.length + expiringToday.length}
          pendingRegistrations={pendingSubmissions.length}
          attendanceIssues={unverifiedCount}
          deviceIssues={offlineDevices}
        />
      </div>
    </div>
  );
}

// ── 1. Global Search ────────────────────────────────────────────────
function GlobalSearch({ balanceByMember, lastVisitByMember }: {
  balanceByMember: Map<string, { total: number; earliestDue: string | null }>;
  lastVisitByMember: Map<string, string>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemberLite[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); return; }
    const handle = setTimeout(async () => {
      setSearching(true);
      const supabase = createClient();
      const { data } = await supabase
        .from("members")
        .select("id, full_name, phone, membership_no, photo_url, status, expiry_date, trainer_id, dob, emergency_name, emergency_phone, membership_start_date, joining_date, monthly_fee, packages(name, monthly_fee), trainer:staff_members!members_trainer_id_fkey(full_name)")
        .is("deleted_at", null)
        .or(`full_name.ilike.%${q}%,phone.ilike.%${q}%,membership_no.ilike.%${q}%`)
        .limit(8);
      setResults((data ?? []) as unknown as MemberLite[]);
      setSearching(false);
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  return (
    <div className="relative">
      <div className="relative">
        <Search className="w-5 h-5 text-[#7A7A72] absolute left-4 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          placeholder="Search member name, phone, membership number..."
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          className="w-full pl-12 pr-4 py-3.5 text-base rounded-xl border-2 border-[#E4E4DE] bg-white focus:outline-none focus:border-[#F06418] shadow-sm"
        />
        {query && (
          <button onClick={() => { setQuery(""); setResults([]); }} className="absolute right-4 top-1/2 -translate-y-1/2 text-[#7A7A72] hover:text-[#1A1A16]">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {open && query.trim().length >= 2 && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full mt-2 bg-white border border-[#E4E4DE] rounded-xl shadow-lg z-20 max-h-[70vh] overflow-y-auto">
            {searching ? (
              <div className="py-8 text-center text-sm text-[#7A7A72]">Searching...</div>
            ) : results.length === 0 ? (
              <div className="py-8 text-center text-sm text-[#7A7A72]">No members found</div>
            ) : (
              <div className="divide-y divide-[#E4E4DE]">
                {results.map((m) => {
                  const balance = balanceByMember.get(m.id)?.total ?? 0;
                  const lastVisit = lastVisitByMember.get(m.id);
                  return (
                    <div key={m.id} className="px-5 py-3.5 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-[#FEF0E8] flex items-center justify-center text-[#F06418] font-bold flex-shrink-0 overflow-hidden">
                        {m.photo_url ? <img src={m.photo_url} alt="" className="w-full h-full object-cover" /> : m.full_name.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-[#1A1A16] truncate">{m.full_name}</p>
                          <Badge variant={m.expiry_date && m.expiry_date < format(new Date(), "yyyy-MM-dd") ? "inactive" : "active"}>
                            {m.status}
                          </Badge>
                        </div>
                        <p className="text-xs text-[#7A7A72]">
                          {m.membership_no} · {m.packages?.name ?? "No package"} · Membership End Date {formatDate(m.expiry_date)}
                          {balance > 0 && <span className="text-red-600 font-semibold"> · {formatPKR(balance)} due</span>}
                          {lastVisit && <span> · Last visit {formatDate(lastVisit)}</span>}
                          {m.trainer?.full_name && <span> · Trainer: {m.trainer.full_name}</span>}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <Link href={`/dashboard/members/${m.id}`}>
                          <span className="px-2.5 py-1.5 rounded-lg border border-[#E4E4DE] text-xs font-semibold text-[#4A4A44] hover:border-[#F06418] hover:text-[#F06418] transition-colors">Profile</span>
                        </Link>
                        <Link href={`/dashboard/members/${m.id}`}>
                          <span className="px-2.5 py-1.5 rounded-lg bg-[#FEF0E8] text-[#F06418] text-xs font-semibold hover:bg-[#F06418] hover:text-white transition-colors">Collect Fee</span>
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── 2. Quick Actions ────────────────────────────────────────────────
function QuickActions() {
  return (
    <div className="flex flex-wrap gap-3">
      <Link href="/dashboard/register">
        <Button size="sm"><UserPlus className="w-4 h-4" /> Register Member</Button>
      </Link>
      <Link href="/dashboard/fees">
        <Button size="sm" variant="secondary"><Plus className="w-4 h-4" /> Collect Fee</Button>
      </Link>
      <Link href="/dashboard/daily-members">
        <Button size="sm" variant="secondary"><Zap className="w-4 h-4" /> Day Pass</Button>
      </Link>
    </div>
  );
}

// ── 3. Needs Attention ──────────────────────────────────────────────
function NeedsAttention({ loading, expiringToday, expiring3, expiring7, paymentFollowUp, goneQuiet, pendingSubmissions, incompleteProfiles, unverifiedCount, offlineDevices }: {
  loading: boolean; expiringToday: number; expiring3: number; expiring7: number;
  paymentFollowUp: number; goneQuiet: number; pendingSubmissions: number;
  incompleteProfiles: number; unverifiedCount: number; offlineDevices: number;
}) {
  const items = [
    { label: "Expiring Today", value: expiringToday, href: "#expiring", severity: "high" },
    { label: "Expiring in 3 Days", value: expiring3, href: "#expiring", severity: "medium" },
    { label: "Expiring in 7 Days", value: expiring7, href: "#expiring", severity: "low" },
    { label: "Payment Follow-up", value: paymentFollowUp, href: "#payments", severity: "high" },
    { label: "Members Gone Quiet", value: goneQuiet, href: "#gonequiet", severity: "medium" },
    { label: "Pending Registrations", value: pendingSubmissions, href: "#registrations", severity: "medium" },
    { label: "Incomplete Profiles", value: incompleteProfiles, href: "#incomplete", severity: "low" },
    { label: "Unverified Attendance", value: unverifiedCount, href: "/dashboard/attendance", severity: "high" },
    { label: "Devices Offline", value: offlineDevices, href: "/dashboard/attendance", severity: "high" },
  ].filter((i) => i.value > 0);

  if (loading) return <div className="bg-white border border-[#E4E4DE] rounded-xl p-5 text-sm text-[#7A7A72]">Loading...</div>;
  if (items.length === 0) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl p-5 flex items-center gap-2.5">
        <CheckCircle2 className="w-5 h-5 text-green-600" />
        <p className="text-sm font-semibold text-green-800">All clear — nothing needs attention right now.</p>
      </div>
    );
  }

  const SEVERITY_STYLE: Record<string, string> = {
    high: "border-red-200 bg-red-50 text-red-700 hover:bg-red-100",
    medium: "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100",
    low: "border-[#E4E4DE] bg-[#F8F8F6] text-[#4A4A44] hover:bg-[#F0F0EE]",
  };

  function scrollTo(href: string) {
    if (href.startsWith("#")) {
      document.getElementById(href.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  return (
    <div className="bg-white border border-[#E4E4DE] rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Bell className="w-4 h-4 text-[#F06418]" />
        <h2 className="text-sm font-bold text-[#1A1A16] uppercase tracking-wide">Needs Attention</h2>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((item) =>
          item.href.startsWith("#") ? (
            <button key={item.label} onClick={() => scrollTo(item.href)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg border text-sm font-semibold transition-colors ${SEVERITY_STYLE[item.severity]}`}>
              <span className="font-bold">{item.value}</span> {item.label}
            </button>
          ) : (
            <Link key={item.label} href={item.href}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg border text-sm font-semibold transition-colors ${SEVERITY_STYLE[item.severity]}`}>
              <span className="font-bold">{item.value}</span> {item.label}
            </Link>
          )
        )}
      </div>
    </div>
  );
}

// ── Shared: reminder action button/status ──────────────────────────
function ReminderAction({ member, type, message, reminderByPhone, currentUserId, onSent }: {
  member: { phone: string; full_name: string };
  type: string;
  message: string;
  reminderByPhone: Map<string, ReminderInfo>;
  currentUserId: string | null;
  onSent: () => void;
}) {
  const [sending, setSending] = useState(false);
  const info = reminderByPhone.get(member.phone);
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const preparedToday = !!info && info.at.slice(0, 10) === todayStr;

  if (preparedToday) {
    return (
      <span className="flex items-center gap-1 text-xs font-semibold text-green-700 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5" />
        Prepared {new Date(info!.at).toLocaleTimeString("en-PK", { hour: "numeric", minute: "2-digit", hour12: true })}
      </span>
    );
  }

  async function handleClick() {
    setSending(true);
    try {
      await prepareReminder({ member, type, message, sentBy: currentUserId });
      toast.success(`Reminder prepared for ${member.full_name}`);
      onSent();
    } catch {
      toast.error("Failed to prepare reminder");
    } finally {
      setSending(false);
    }
  }

  return (
    <button onClick={handleClick} disabled={sending}
      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#FEF0E8] text-[#F06418] text-xs font-semibold hover:bg-[#F06418] hover:text-white transition-colors disabled:opacity-50 whitespace-nowrap">
      <MessageSquare className="w-3 h-3" /> {sending ? "..." : "Send Reminder"}
    </button>
  );
}

function ReminderStatusLabel({ member, reminderByPhone }: { member: { phone: string }; reminderByPhone: Map<string, ReminderInfo> }) {
  const info = reminderByPhone.get(member.phone);
  if (!info) return <span className="text-[10px] text-[#7A7A72]">Not Prepared</span>;
  return <span className="text-[10px] text-[#7A7A72]">Prepared {formatDate(info.at)}</span>;
}

// ── 4. Expiring Members — reminder work queue ──────────────────────
function ExpiringMembers({ loading, expiringToday, expiring3, expiring7, alreadyExpired, balanceByMember, lastVisitByMember, reminderByPhone, currentUserId, onReminderSent }: {
  loading: boolean;
  expiringToday: MemberLite[]; expiring3: MemberLite[]; expiring7: MemberLite[]; alreadyExpired: MemberLite[];
  balanceByMember: Map<string, { total: number; earliestDue: string | null }>;
  lastVisitByMember: Map<string, string>;
  reminderByPhone: Map<string, ReminderInfo>;
  currentUserId: string | null;
  onReminderSent: () => void;
}) {
  type SubTab = "today" | "3days" | "7days" | "expired";
  const [subTab, setSubTab] = useState<SubTab>("today");
  const buckets: Record<SubTab, MemberLite[]> = { today: expiringToday, "3days": expiring3, "7days": expiring7, expired: alreadyExpired };
  const TAB_LABELS: Record<SubTab, string> = { today: "Today", "3days": "Next 3 Days", "7days": "Next 7 Days", expired: "Already Expired" };
  const rows = buckets[subTab];
  const total = expiringToday.length + expiring3.length + expiring7.length + alreadyExpired.length;

  if (!loading && total === 0) return null;

  return (
    <Card padding={false} id="expiring">
      <div className="px-5 py-4 border-b border-[#E4E4DE]">
        <h2 className="text-base font-bold text-[#1A1A16]">Memberships Expiring</h2>
        <p className="text-xs text-[#7A7A72] mt-0.5">Reminder work queue — {total} member{total !== 1 ? "s" : ""} across all windows</p>
      </div>
      <div className="px-5 pt-3 flex gap-1 flex-wrap">
        {(Object.keys(buckets) as SubTab[]).map((k) => (
          <button key={k} onClick={() => setSubTab(k)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${subTab === k ? "bg-[#F06418] text-white" : "bg-[#F8F8F6] text-[#4A4A44] hover:bg-[#F0F0EE]"}`}>
            {TAB_LABELS[k]}
            {buckets[k].length > 0 && <span className={`text-[10px] font-bold px-1.5 rounded-full ${subTab === k ? "bg-white/30" : "bg-[#E4E4DE]"}`}>{buckets[k].length}</span>}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="py-8 text-center text-sm text-[#7A7A72]">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="py-8 text-center text-sm text-[#7A7A72]">Nothing in this window.</div>
      ) : (
        <div className="divide-y divide-[#E4E4DE] mt-3 max-h-72 overflow-y-auto">
          {rows.map((m) => {
            const balance = balanceByMember.get(m.id)?.total ?? 0;
            const lastVisit = lastVisitByMember.get(m.id);
            const message = `Hi ${m.full_name}, your Level Up Fitness membership ${subTab === "expired" ? "has expired" : `expires ${formatDate(m.expiry_date)}`}. Please renew to continue enjoying uninterrupted access.`;
            return (
              <div key={m.id} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={`/dashboard/members/${m.id}`} className="text-sm font-semibold text-[#1A1A16] hover:text-[#F06418]">{m.full_name}</Link>
                    <span className="text-xs text-[#7A7A72]">{m.packages?.name ?? "—"}</span>
                  </div>
                  <p className="text-xs text-[#7A7A72] mt-0.5">
                    {subTab === "expired" ? `Membership Ended ${formatDate(m.expiry_date)}` : `Membership End Date ${formatDate(m.expiry_date)}`}
                    {lastVisit && ` · Visited ${formatDate(lastVisit)}`}
                    {balance > 0 && <span className="text-red-600 font-semibold"> · {formatPKR(balance)} due</span>}
                  </p>
                  <div className="mt-1"><ReminderStatusLabel member={m} reminderByPhone={reminderByPhone} /></div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <ReminderAction member={m} type={REMINDER_TYPE_EXPIRY} message={message} reminderByPhone={reminderByPhone} currentUserId={currentUserId} onSent={onReminderSent} />
                  <Link href={`/dashboard/members/${m.id}`}>
                    <span className="px-2.5 py-1 rounded-lg border border-[#E4E4DE] text-xs font-semibold text-[#4A4A44] hover:border-[#F06418] hover:text-[#F06418] transition-colors">Collect Fee</span>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ── 5. Payment Follow-up ─────────────────────────────────────────────
function PaymentFollowUp({ loading, members, balanceByMember, reminderByPhone, currentUserId, onReminderSent }: {
  loading: boolean; members: MemberLite[];
  balanceByMember: Map<string, { total: number; earliestDue: string | null }>;
  reminderByPhone: Map<string, ReminderInfo>;
  currentUserId: string | null;
  onReminderSent: () => void;
}) {
  if (!loading && members.length === 0) return null;
  const sorted = [...members].sort((a, b) => (balanceByMember.get(b.id)?.total ?? 0) - (balanceByMember.get(a.id)?.total ?? 0));

  return (
    <Card padding={false} id="payments">
      <div className="px-5 py-4 border-b border-[#E4E4DE]">
        <h2 className="text-base font-bold text-[#1A1A16]">Payment Follow-up — {members.length} Member{members.length !== 1 ? "s" : ""}</h2>
        <p className="text-xs text-[#7A7A72] mt-0.5">Members with an outstanding balance who need follow-up</p>
      </div>
      {loading ? (
        <div className="py-8 text-center text-sm text-[#7A7A72]">Loading...</div>
      ) : (
        <div className="divide-y divide-[#E4E4DE] max-h-72 overflow-y-auto">
          {sorted.map((m) => {
            const bal = balanceByMember.get(m.id);
            const dueDate = bal?.earliestDue ?? null;
            const daysOverdue = dueDate ? Math.max(daysSince(dueDate) ?? 0, 0) : 0;
            const message = `Hi ${m.full_name}, this is a reminder that you have an outstanding balance of ${formatPKR(bal?.total ?? 0)} at Level Up Fitness. Please settle at your earliest convenience.`;
            return (
              <div key={m.id} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <Link href={`/dashboard/members/${m.id}`} className="text-sm font-semibold text-[#1A1A16] hover:text-[#F06418]">{m.full_name}</Link>
                  <p className="text-xs text-[#7A7A72] mt-0.5">
                    <span className="font-bold text-red-600">{formatPKR(bal?.total ?? 0)}</span> due
                    {dueDate && ` · ${formatDate(dueDate)}`}
                    {daysOverdue > 0 && <span className="text-red-600"> · {daysOverdue}d overdue</span>}
                  </p>
                  <div className="mt-1"><ReminderStatusLabel member={m} reminderByPhone={reminderByPhone} /></div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <ReminderAction member={m} type={REMINDER_TYPE_BALANCE} message={message} reminderByPhone={reminderByPhone} currentUserId={currentUserId} onSent={onReminderSent} />
                  <Link href={`/dashboard/members/${m.id}`}>
                    <span className="px-2.5 py-1 rounded-lg border border-[#E4E4DE] text-xs font-semibold text-[#4A4A44] hover:border-[#F06418] hover:text-[#F06418] transition-colors">Collect Fee</span>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ── 6. Members Gone Quiet ────────────────────────────────────────────
function GoneQuiet({ loading, members, lastVisitByMember, reminderByPhone, currentUserId, onReminderSent }: {
  loading: boolean; members: MemberLite[]; lastVisitByMember: Map<string, string>;
  reminderByPhone: Map<string, ReminderInfo>; currentUserId: string | null; onReminderSent: () => void;
}) {
  const [thresholdDays, setThresholdDays] = useState(7);
  const todayStr = format(new Date(), "yyyy-MM-dd");

  const filtered = useMemo(() => members
    .filter((m) => {
      const lv = lastVisitByMember.get(m.id);
      const days = lv ? daysSince(lv.slice(0, 10)) : null;
      return (days === null || days >= thresholdDays) && (!m.expiry_date || m.expiry_date >= todayStr);
    })
    .sort((a, b) => {
      const da = lastVisitByMember.get(a.id); const db = lastVisitByMember.get(b.id);
      if (!da && !db) return 0;
      if (!da) return -1;
      if (!db) return 1;
      return da.localeCompare(db);
    }), [members, lastVisitByMember, thresholdDays, todayStr]);

  if (!loading && filtered.length === 0) return null;

  return (
    <Card padding={false} id="gonequiet">
      <div className="px-5 py-4 border-b border-[#E4E4DE] flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-bold text-[#1A1A16]">Members Gone Quiet</h2>
          <p className="text-xs text-[#7A7A72] mt-0.5">Active members who haven't visited recently</p>
        </div>
        <select value={thresholdDays} onChange={(e) => setThresholdDays(Number(e.target.value))}
          className="text-xs px-2.5 py-1.5 rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]">
          {[7, 10, 14, 30].map((d) => <option key={d} value={d}>{d} days</option>)}
        </select>
      </div>
      {loading ? (
        <div className="py-8 text-center text-sm text-[#7A7A72]">Loading...</div>
      ) : (
        <div className="divide-y divide-[#E4E4DE] max-h-72 overflow-y-auto">
          {filtered.slice(0, 30).map((m) => {
            const lv = lastVisitByMember.get(m.id);
            const days = lv ? daysSince(lv.slice(0, 10)) : null;
            const message = `Hi ${m.full_name}, we haven't seen you at Level Up Fitness in a while — we'd love to have you back!`;
            return (
              <div key={m.id} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <Link href={`/dashboard/members/${m.id}`} className="text-sm font-semibold text-[#1A1A16] hover:text-[#F06418]">{m.full_name}</Link>
                  <p className="text-xs text-[#7A7A72] mt-0.5">
                    {lv ? `${days}d since last visit (${formatDate(lv)})` : "No visit on record"}
                    {m.trainer?.full_name && ` · Trainer: ${m.trainer.full_name}`}
                  </p>
                </div>
                <ReminderAction member={m} type={REMINDER_TYPE_INACTIVE} message={message} reminderByPhone={reminderByPhone} currentUserId={currentUserId} onSent={onReminderSent} />
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ── 7. My Tasks ───────────────────────────────────────────────────────
interface TaskRow { id: string; title: string; member_id: string | null; due_date: string | null; priority: "low" | "medium" | "high"; status: "pending" | "completed" | "snoozed"; member?: { full_name: string } | null }

function MyTasks({ currentUserId, refreshKey }: { currentUserId: string | null; refreshKey: number }) {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"today" | "upcoming" | "completed">("today");
  const [addOpen, setAddOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDue, setNewDue] = useState(format(new Date(), "yyyy-MM-dd"));
  const [newPriority, setNewPriority] = useState<"low" | "medium" | "high">("medium");
  const [saving, setSaving] = useState(false);

  const fetchTasks = useCallback(async () => {
    if (!currentUserId) { setLoading(false); return; }
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("staff_tasks")
      .select("id, title, member_id, due_date, priority, status, member:members(full_name)")
      .eq("assigned_to", currentUserId)
      .is("deleted_at", null)
      .neq("status", "completed")
      .order("due_date", { ascending: true, nullsFirst: false });
    setTasks((data ?? []) as unknown as TaskRow[]);
    setLoading(false);
  }, [currentUserId]);

  useEffect(() => { fetchTasks(); }, [fetchTasks, refreshKey]);

  async function addTask() {
    if (!newTitle.trim() || !currentUserId) { toast.error("Enter a task title"); return; }
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from("staff_tasks").insert({
      title: newTitle.trim(), due_date: newDue || null, priority: newPriority,
      assigned_to: currentUserId, created_by: currentUserId, status: "pending",
    });
    setSaving(false);
    if (error) { toast.error("Failed to add task"); return; }
    setNewTitle(""); setNewDue(format(new Date(), "yyyy-MM-dd")); setNewPriority("medium");
    setAddOpen(false);
    fetchTasks();
  }

  async function completeTask(id: string) {
    const supabase = createClient();
    await supabase.from("staff_tasks").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", id);
    fetchTasks();
  }

  async function snoozeTask(id: string) {
    const tomorrow = format(subDays(new Date(), -1), "yyyy-MM-dd");
    const supabase = createClient();
    await supabase.from("staff_tasks").update({ due_date: tomorrow }).eq("id", id);
    fetchTasks();
  }

  const todayStr = format(new Date(), "yyyy-MM-dd");
  const visible = tasks.filter((t) => view === "today" ? (t.due_date ?? todayStr) <= todayStr : t.due_date && t.due_date > todayStr);
  const PRIORITY_DOT: Record<string, string> = { high: "bg-red-500", medium: "bg-amber-400", low: "bg-[#7A7A72]" };

  return (
    <Card padding={false}>
      <div className="px-5 py-4 border-b border-[#E4E4DE] flex items-center justify-between">
        <h2 className="text-base font-bold text-[#1A1A16]">My Tasks</h2>
        <button onClick={() => setAddOpen(true)} className="text-xs font-semibold text-[#F06418] hover:underline flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add</button>
      </div>
      <div className="px-5 pt-3 flex gap-1">
        {(["today", "upcoming"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${view === v ? "bg-[#F06418] text-white" : "bg-[#F8F8F6] text-[#4A4A44] hover:bg-[#F0F0EE]"}`}>
            {v}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="py-8 text-center text-sm text-[#7A7A72]">Loading...</div>
      ) : visible.length === 0 ? (
        <div className="py-8 text-center text-sm text-[#7A7A72]">Nothing here — you're caught up.</div>
      ) : (
        <div className="divide-y divide-[#E4E4DE] mt-3 max-h-64 overflow-y-auto">
          {visible.map((t) => (
            <div key={t.id} className="px-5 py-2.5 flex items-center gap-2.5">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${PRIORITY_DOT[t.priority]}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-[#1A1A16] truncate">{t.title}</p>
                <p className="text-[10px] text-[#7A7A72]">
                  {t.member?.full_name && `${t.member.full_name} · `}
                  {t.due_date ? formatDate(t.due_date) : "No due date"}
                </p>
              </div>
              <button onClick={() => snoozeTask(t.id)} title="Snooze to tomorrow" className="p-1 rounded text-[#7A7A72] hover:text-[#F06418] hover:bg-[#FEF0E8]"><Clock className="w-3.5 h-3.5" /></button>
              <button onClick={() => completeTask(t.id)} title="Complete" className="p-1 rounded text-[#7A7A72] hover:text-green-600 hover:bg-green-50"><CheckCircle2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Task" size="sm">
        <div className="p-5 space-y-4">
          <div>
            <label className="text-sm font-medium text-[#1A1A16] block mb-1.5">Task</label>
            <input type="text" placeholder="e.g. Call Ali about renewal" value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-[#1A1A16] block mb-1.5">Due Date</label>
              <input type="date" value={newDue} min="1900-01-01" max="2099-12-31"
                onChange={(e) => { const v = safeDateValue(e.target.value); if (v !== null) setNewDue(v); }}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]" />
            </div>
            <div>
              <label className="text-sm font-medium text-[#1A1A16] block mb-1.5">Priority</label>
              <select value={newPriority} onChange={(e) => setNewPriority(e.target.value as any)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[#E4E4DE] bg-white focus:outline-none focus:ring-2 focus:ring-[#F06418]">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>
          <Button onClick={addTask} loading={saving} className="w-full">Add Task</Button>
        </div>
      </Modal>
    </Card>
  );
}

// ── 8. Today's Check-ins ─────────────────────────────────────────────
function TodayCheckins({ loading, checkins, members, balanceByMember, lastVisitByMember }: {
  loading: boolean; checkins: { member_id: string; punch_time: string }[]; members: MemberLite[];
  balanceByMember: Map<string, { total: number; earliestDue: string | null }>;
  lastVisitByMember: Map<string, string>;
}) {
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const todayStr = format(new Date(), "yyyy-MM-dd");

  // Latest punch per member today only (avoid showing the same arrival twice).
  const latestByMember = new Map<string, string>();
  for (const c of checkins) if (!latestByMember.has(c.member_id)) latestByMember.set(c.member_id, c.punch_time);
  const rows = [...latestByMember.entries()].slice(0, 15);

  return (
    <Card padding={false} className="lg:col-span-1">
      <div className="px-5 py-4 border-b border-[#E4E4DE] flex items-center gap-2">
        <CalendarCheck className="w-4 h-4 text-green-600" />
        <h2 className="text-sm font-bold text-[#1A1A16]">Today's Check-ins</h2>
        <Link href="/dashboard/attendance" className="ml-auto text-[10px] text-[#F06418] font-semibold hover:underline">Full Log</Link>
      </div>
      {loading ? (
        <div className="py-8 text-center text-sm text-[#7A7A72]">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="py-8 text-center text-sm text-[#7A7A72]">No check-ins yet today.</div>
      ) : (
        <div className="divide-y divide-[#E4E4DE] max-h-96 overflow-y-auto">
          {rows.map(([memberId, punchTime]) => {
            const m = memberById.get(memberId);
            if (!m) return null;
            const balance = balanceByMember.get(m.id)?.total ?? 0;
            const daysToExpiry = daysUntilExpiry(m.expiry_date);
            const expired = daysToExpiry !== null && daysToExpiry < 0;
            const expiringSoon = daysToExpiry !== null && daysToExpiry >= 0 && daysToExpiry <= 3;
            const alerts: string[] = [];
            if (expired) alerts.push("Membership has expired");
            else if (expiringSoon) alerts.push(`Expires in ${daysToExpiry}d`);
            if (balance > 0) alerts.push(`${formatPKR(balance)} outstanding`);
            const flagged = alerts.length > 0;
            return (
              <div key={memberId} className={`px-5 py-2.5 flex items-center justify-between gap-2 ${flagged ? "bg-amber-50" : ""}`}>
                <div className="min-w-0 flex-1">
                  <Link href={`/dashboard/members/${m.id}`} className="text-sm font-semibold text-[#1A1A16] hover:text-[#F06418]">{m.full_name}</Link>
                  <p className="text-[10px] text-[#7A7A72]">
                    Checked in {new Date(punchTime).toLocaleTimeString("en-PK", { hour: "numeric", minute: "2-digit", hour12: true })}
                  </p>
                  {flagged ? (
                    <p className="text-[10px] font-semibold text-amber-700 mt-0.5">{alerts.join(" + ")}</p>
                  ) : (
                    <p className="text-[10px] font-semibold text-green-700 mt-0.5 flex items-center gap-1"><CheckCircle2 className="w-2.5 h-2.5" /> All Good</p>
                  )}
                </div>
                {flagged && (
                  <Link href={`/dashboard/members/${m.id}`}>
                    <span className="px-2 py-1 rounded-lg bg-[#FEF0E8] text-[#F06418] text-[10px] font-semibold hover:bg-[#F06418] hover:text-white transition-colors whitespace-nowrap">Act</span>
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ── 9. Registration Queue ────────────────────────────────────────────
function RegistrationQueue({ loading, submissions, incompleteIds, canApprove }: {
  loading: boolean; submissions: any[]; incompleteIds: Set<string>; canApprove: boolean;
}) {
  if (!loading && submissions.length === 0) return null;
  return (
    <Card padding={false} id="registrations">
      <div className="px-5 py-4 border-b border-[#E4E4DE] flex items-center gap-2">
        <ClipboardList className="w-4 h-4 text-[#F06418]" />
        <h2 className="text-sm font-bold text-[#1A1A16]">Registration Queue</h2>
        <Link href="/dashboard/submissions" className="ml-auto text-[10px] text-[#F06418] font-semibold hover:underline">Open</Link>
      </div>
      {loading ? (
        <div className="py-8 text-center text-sm text-[#7A7A72]">Loading...</div>
      ) : (
        <div className="divide-y divide-[#E4E4DE] max-h-96 overflow-y-auto">
          {submissions.slice(0, 15).map((s) => {
            const incomplete = incompleteIds.has(s.id);
            return (
              <Link key={s.id} href="/dashboard/submissions" className="px-5 py-2.5 flex items-center justify-between gap-2 hover:bg-[#F8F8F6]">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#1A1A16] truncate">{s.full_name}</p>
                  <p className="text-[10px] text-[#7A7A72]">Submitted {formatDate(s.created_at)}</p>
                </div>
                <Badge variant={incomplete ? "pending" : "default"}>{incomplete ? "Incomplete" : canApprove ? "Ready for Review" : "Pending"}</Badge>
              </Link>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ── 10. Attendance / Device Issues ───────────────────────────────────
function AttendanceIssues({ loading, unverifiedCount, devicesOnline, devicesTotal }: {
  loading: boolean; unverifiedCount: number; devicesOnline: number; devicesTotal: number;
}) {
  const offline = devicesTotal - devicesOnline;
  if (!loading && unverifiedCount === 0 && offline === 0) return null;
  return (
    <Card padding={false}>
      <div className="px-5 py-4 border-b border-[#E4E4DE] flex items-center gap-2">
        <Wifi className="w-4 h-4 text-[#F06418]" />
        <h2 className="text-sm font-bold text-[#1A1A16]">Attendance Needs Attention</h2>
        <Link href="/dashboard/attendance" className="ml-auto text-[10px] text-[#F06418] font-semibold hover:underline">Open</Link>
      </div>
      {loading ? (
        <div className="py-8 text-center text-sm text-[#7A7A72]">Loading...</div>
      ) : (
        <div className="p-5 space-y-2">
          {unverifiedCount > 0 && (
            <Link href="/dashboard/attendance" className="flex items-center justify-between px-3 py-2 rounded-lg bg-red-50 border border-red-200 hover:bg-red-100 transition-colors">
              <span className="text-xs font-semibold text-red-700">{unverifiedCount} Unverified Punch{unverifiedCount !== 1 ? "es" : ""}</span>
              <span className="text-[10px] font-semibold text-red-700">Resolve →</span>
            </Link>
          )}
          {offline > 0 && (
            <Link href="/dashboard/attendance" className="flex items-center justify-between px-3 py-2 rounded-lg bg-red-50 border border-red-200 hover:bg-red-100 transition-colors">
              <span className="text-xs font-semibold text-red-700">{offline} Device{offline !== 1 ? "s" : ""} Offline</span>
              <span className="text-[10px] font-semibold text-red-700">View →</span>
            </Link>
          )}
        </div>
      )}
    </Card>
  );
}

// ── 11. Incomplete Profiles ───────────────────────────────────────────
function IncompleteProfiles({ loading, members }: { loading: boolean; members: MemberLite[] }) {
  if (!loading && members.length === 0) return null;
  const missingPhoto = members.filter((m) => !m.photo_url).length;
  const missingEmergency = members.filter((m) => !m.emergency_name || !m.emergency_phone).length;

  return (
    <Card padding={false} id="incomplete">
      <div className="px-5 py-4 border-b border-[#E4E4DE]">
        <h2 className="text-sm font-bold text-[#1A1A16]">Profiles Needing Attention</h2>
      </div>
      {loading ? (
        <div className="py-8 text-center text-sm text-[#7A7A72]">Loading...</div>
      ) : (
        <div className="p-5 space-y-2">
          {missingPhoto > 0 && <p className="text-xs text-[#4A4A44]">{missingPhoto} missing photo{missingPhoto !== 1 ? "s" : ""}</p>}
          {missingEmergency > 0 && <p className="text-xs text-[#4A4A44]">{missingEmergency} missing emergency contact{missingEmergency !== 1 ? "s" : ""}</p>}
          <div className="flex flex-wrap gap-1.5 pt-2">
            {members.slice(0, 6).map((m) => (
              <Link key={m.id} href={`/dashboard/members/${m.id}`}
                className="px-2.5 py-1 rounded-lg border border-[#E4E4DE] text-[10px] font-semibold text-[#4A4A44] hover:border-[#F06418] hover:text-[#F06418] transition-colors">
                {m.full_name}
              </Link>
            ))}
            {members.length > 6 && <span className="text-[10px] text-[#7A7A72] self-center">+{members.length - 6} more</span>}
          </div>
        </div>
      )}
    </Card>
  );
}

// ── 12. Today's Walk-ins ──────────────────────────────────────────────
function TodayWalkIns({ loading, walkIns }: { loading: boolean; walkIns: any[] }) {
  if (!loading && walkIns.length === 0) return null;
  const converted = walkIns.filter((w) => w.converted_to_member_id).length;
  return (
    <Card padding={false}>
      <div className="px-5 py-4 border-b border-[#E4E4DE] flex items-center justify-between">
        <h2 className="text-sm font-bold text-[#1A1A16]">Today's Walk-ins</h2>
        <Link href="/dashboard/daily-members" className="text-[10px] text-[#F06418] font-semibold hover:underline">Open</Link>
      </div>
      {loading ? (
        <div className="py-8 text-center text-sm text-[#7A7A72]">Loading...</div>
      ) : (
        <div className="p-5 space-y-3">
          <div className="flex gap-4 text-xs text-[#4A4A44]">
            <span><span className="font-bold text-[#1A1A16]">{walkIns.length}</span> visitors</span>
            <span><span className="font-bold text-[#1A1A16]">{converted}</span> converted</span>
          </div>
          <div className="divide-y divide-[#E4E4DE]">
            {walkIns.slice(0, 6).map((w) => (
              <div key={w.id} className="py-2 flex items-center justify-between gap-2">
                <span className="text-xs text-[#1A1A16]">{w.full_name}</span>
                {w.converted_to_member_id ? (
                  <Badge variant="active">Converted</Badge>
                ) : (
                  <Link href="/dashboard/daily-members" className="text-[10px] font-semibold text-[#F06418] hover:underline">Convert</Link>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// ── 13. Birthdays ──────────────────────────────────────────────────────
function Birthdays({ loading, members, reminderByPhone, currentUserId, onReminderSent }: {
  loading: boolean; members: MemberLite[]; reminderByPhone: Map<string, ReminderInfo>; currentUserId: string | null; onReminderSent: () => void;
}) {
  if (!loading && members.length === 0) return null;
  return (
    <Card padding={false}>
      <div className="px-5 py-4 border-b border-[#E4E4DE] flex items-center gap-2">
        <Cake className="w-4 h-4 text-[#7A7A72]" />
        <h2 className="text-sm font-bold text-[#1A1A16]">Birthdays Today</h2>
      </div>
      {loading ? (
        <div className="py-8 text-center text-sm text-[#7A7A72]">Loading...</div>
      ) : (
        <div className="divide-y divide-[#E4E4DE]">
          {members.map((m) => {
            const message = `Happy Birthday ${m.full_name}! 🎉 Wishing you a great year ahead from all of us at Level Up Fitness.`;
            return (
              <div key={m.id} className="px-5 py-2.5 flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm text-[#1A1A16]">{m.full_name}</p>
                  {m.trainer?.full_name && <p className="text-[10px] text-[#7A7A72]">Trainer: {m.trainer.full_name}</p>}
                </div>
                <ReminderAction member={m} type={REMINDER_TYPE_BIRTHDAY} message={message} reminderByPhone={reminderByPhone} currentUserId={currentUserId} onSent={onReminderSent} />
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ── 14. End-of-Day handover ────────────────────────────────────────────
// Lightweight and per-browser (localStorage) — no shift/handover table
// exists in the schema, and the brief is explicit about not inventing one.
// This is a checklist layered over live-computed numbers, not a persisted
// record; it resets automatically each calendar day.
function EndOfDaySummary({ followUps, pendingRegistrations, attendanceIssues, deviceIssues }: {
  followUps: number; pendingRegistrations: number; attendanceIssues: number; deviceIssues: number;
}) {
  const [open, setOpen] = useState(false);
  const todayKey = `eod-checklist-${format(new Date(), "yyyy-MM-dd")}`;
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(todayKey);
      setChecked(raw ? JSON.parse(raw) : {});
    } catch { setChecked({}); }
  }, [todayKey]);

  function toggle(key: string) {
    const next = { ...checked, [key]: !checked[key] };
    setChecked(next);
    try { localStorage.setItem(todayKey, JSON.stringify(next)); } catch {}
  }

  const items = [
    { key: "payments", label: `Payment follow-ups reviewed (${followUps})` },
    { key: "registrations", label: `Pending registrations reviewed (${pendingRegistrations})` },
    { key: "attendance", label: `Attendance issues reviewed (${attendanceIssues})` },
    { key: "devices", label: `Device issues reported (${deviceIssues})` },
  ];

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#E4E4DE] bg-white text-sm font-semibold text-[#4A4A44] hover:border-[#F06418] hover:text-[#F06418] transition-colors w-fit">
        <ListChecks className="w-4 h-4" /> End of Day Summary
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="End of Day Summary" size="sm">
        <div className="p-5 space-y-3">
          <p className="text-xs text-[#7A7A72]">Quick checklist for your shift — saved on this device only.</p>
          {items.map((item) => (
            <label key={item.key} className="flex items-center gap-2.5 text-sm text-[#1A1A16] cursor-pointer">
              <input type="checkbox" className="accent-[#F06418]" checked={!!checked[item.key]} onChange={() => toggle(item.key)} />
              {item.label}
            </label>
          ))}
        </div>
      </Modal>
    </>
  );
}
