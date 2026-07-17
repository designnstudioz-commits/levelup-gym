import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Users,
  ClipboardList,
  Plus,
  ArrowRight,
  AlertCircle,
  Wallet,
  UserCog,
  Zap,
  Wifi,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { DashboardStats, type UnpaidMember } from "@/components/dashboard/DashboardStats";
import { StatsCard } from "@/components/ui/StatsCard";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatDate, formatPKR, timeAgo, getMemberStatusDisplay, isDeviceOnline } from "@/lib/utils";

// Maps an activity log's entity back to the page a user would want to
// navigate to — lets "Recent Activity" rows act as real links, not just text.
function activityLink(entityType: string, entityId: string | null): string | null {
  if (!entityId) {
    if (entityType === "submission") return "/dashboard/submissions";
    if (entityType === "daily_member") return "/dashboard/daily-members";
    return null;
  }
  switch (entityType) {
    case "member":        return `/dashboard/members/${entityId}`;
    case "staff_member":  return `/dashboard/staff/${entityId}`;
    case "submission":    return "/dashboard/submissions";
    case "daily_member":  return "/dashboard/daily-members";
    case "package":       return "/dashboard/packages";
    case "device":        return "/dashboard/attendance";
    case "system_user":   return "/dashboard/settings";
    default:              return null;
  }
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: systemUser } = await supabase
    .from("system_users")
    .select("role")
    .eq("email", user.email!.toLowerCase())
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();
  const isReceptionist = systemUser?.role === "receptionist";

  const today = new Date().toISOString().split("T")[0];
  const monthStart = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-01`;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];

  // Fetch all dashboard data in parallel
  const [
    { count: todayAttendanceCount },
    { data: monthlyRevenueData },
    { count: pendingSubmissionsCount },
    { data: membersData },
    { data: recentPayments30 },
    { data: expiringMembers },
    { data: recentActivity },
    { data: expensesData },
    { count: activeStaffCount },
    { count: walkinsTodayCount },
    { data: devices },
  ] = await Promise.all([
    supabase
      .from("attendances")
      .select("*", { count: "exact", head: true })
      .gte("punch_time", `${today}T00:00:00`)
      .lte("punch_time", `${today}T23:59:59`),

    supabase
      .from("fee_payments")
      .select("amount")
      .gte("payment_date", monthStart)
      .is("deleted_at", null),

    supabase
      .from("submissions")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending")
      .is("deleted_at", null),

    supabase
      .from("members")
      .select("id, full_name, expiry_date, monthly_fee, packages(monthly_fee)")
      .eq("status", "active")
      .is("deleted_at", null),

    supabase
      .from("fee_payments")
      .select("member_id")
      .gte("payment_date", thirtyDaysAgo)
      .is("deleted_at", null),

    supabase
      .from("members")
      .select("id, full_name, phone, expiry_date, status, package_id, packages(name)")
      .eq("status", "active")
      .is("deleted_at", null)
      .gte("expiry_date", today)
      .lte("expiry_date", new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0])
      .order("expiry_date", { ascending: true })
      .limit(10),

    supabase
      .from("activity_logs")
      .select("id, action, description, entity_type, entity_id, created_at")
      .order("created_at", { ascending: false })
      .limit(8),

    supabase
      .from("expenses")
      .select("amount")
      .gte("expense_date", monthStart)
      .is("deleted_at", null),

    supabase
      .from("staff_members")
      .select("*", { count: "exact", head: true })
      .eq("status", "active")
      .is("deleted_at", null),

    supabase
      .from("daily_members")
      .select("*", { count: "exact", head: true })
      .eq("visit_date", today)
      .is("deleted_at", null),

    supabase.from("devices").select("id, last_seen"),
  ]);

  const monthlyRevenue =
    monthlyRevenueData?.reduce((sum, row) => sum + (row.amount ?? 0), 0) ?? 0;
  const monthlyExpenses =
    expensesData?.reduce((sum, row) => sum + (row.amount ?? 0), 0) ?? 0;

  // Split active members into paid vs unpaid — mirrors the Fees page's own
  // "Outstanding Dues" definition (expired + no payment in the last 30 days)
  // so the numbers agree everywhere in the app.
  const paidMemberIds = new Set((recentPayments30 ?? []).map((p) => p.member_id));
  const expiredMembers = (membersData ?? []).filter((m) => m.expiry_date && m.expiry_date < today);
  const unpaidActiveMembers = (membersData ?? []).filter(
    (m) => (!m.expiry_date || m.expiry_date >= today) && !paidMemberIds.has(m.id)
  );
  const unpaidRaw = [...expiredMembers, ...unpaidActiveMembers];
  const unpaidIds = new Set(unpaidRaw.map((m) => m.id));
  const paidCount = (membersData?.length ?? 0) - unpaidIds.size;

  const unpaidMembers: UnpaidMember[] = unpaidRaw
    .map((m) => ({
      id: m.id,
      full_name: m.full_name,
      expiry_date: m.expiry_date,
      amount: m.monthly_fee ?? (m as any).packages?.monthly_fee ?? 0,
      isExpired: !!(m.expiry_date && m.expiry_date < today),
    }))
    .sort((a, b) => Number(b.isExpired) - Number(a.isExpired));
  const totalUnpaidAmount = unpaidMembers.reduce((s, m) => s + m.amount, 0);

  const onlineDeviceCount = (devices ?? []).filter((d) => isDeviceOnline(d.last_seen)).length;
  const totalDeviceCount = devices?.length ?? 0;

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title="Dashboard"
        subtitle={`Today — ${formatDate(new Date().toISOString())}`}
      />

      <div className="flex-1 p-6 space-y-6">
        <DashboardStats
          paidCount={paidCount}
          unpaidMembers={unpaidMembers}
          totalUnpaidAmount={totalUnpaidAmount}
          todayAttendanceCount={todayAttendanceCount ?? 0}
          monthlyRevenue={monthlyRevenue}
          isReceptionist={isReceptionist}
          pendingSubmissionsCount={pendingSubmissionsCount ?? 0}
        />

        {/* Quick actions */}
        <div className="flex flex-wrap gap-3">
          <Link href="/dashboard/register">
            <Button size="sm">
              <Plus className="w-4 h-4" />
              Add Member
            </Button>
          </Link>
          <Link href="/dashboard/submissions">
            <Button size="sm" variant="secondary">
              <ClipboardList className="w-4 h-4" />
              View Submissions
              {pendingSubmissionsCount ? (
                <span className="bg-[#F06418] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {pendingSubmissionsCount}
                </span>
              ) : null}
            </Button>
          </Link>
          <Link href="/dashboard/members">
            <Button size="sm" variant="secondary">
              <Users className="w-4 h-4" />
              All Members
            </Button>
          </Link>
        </div>

        {/* Module quick-previews */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {!isReceptionist && (
            <Link href="/dashboard/reports">
              <StatsCard
                title="Expenses (This Month)"
                value={formatPKR(monthlyExpenses)}
                icon={Wallet}
                iconColor="text-red-600"
                iconBg="bg-red-50"
                className="hover:border-[#F06418] transition-colors cursor-pointer"
              />
            </Link>
          )}
          {!isReceptionist && (
            <Link href="/dashboard/staff">
              <StatsCard
                title="Active Staff"
                value={activeStaffCount ?? 0}
                icon={UserCog}
                iconColor="text-purple-600"
                iconBg="bg-purple-50"
                className="hover:border-[#F06418] transition-colors cursor-pointer"
              />
            </Link>
          )}
          <Link href="/dashboard/daily-members">
            <StatsCard
              title="Walk-ins Today"
              value={walkinsTodayCount ?? 0}
              icon={Zap}
              iconColor="text-[#F06418]"
              iconBg="bg-[#FEF0E8]"
              className="hover:border-[#F06418] transition-colors cursor-pointer"
            />
          </Link>
          <Link href="/dashboard/attendance">
            <StatsCard
              title="Devices Online"
              value={`${onlineDeviceCount}/${totalDeviceCount}`}
              icon={Wifi}
              iconColor="text-green-600"
              iconBg="bg-green-50"
              className="hover:border-[#F06418] transition-colors cursor-pointer"
            />
          </Link>
        </div>

        {/* Recent activity */}
        <Card padding={false}>
          <div className="px-5 py-4 border-b border-[#E4E4DE]">
            <h3 className="text-base font-semibold text-[#1A1A16]">Recent Activity</h3>
          </div>
          {!recentActivity?.length ? (
            <div className="px-5 py-10 text-center text-sm text-[#7A7A72]">No activity yet</div>
          ) : (
            <div className="divide-y divide-[#E4E4DE]">
              {recentActivity.map((log) => {
                const href = activityLink(log.entity_type, log.entity_id);
                const inner = (
                  <>
                    <p className="text-xs text-[#1A1A16] leading-snug">{log.description}</p>
                    <p className="text-[10px] text-[#7A7A72] mt-0.5">{timeAgo(log.created_at)}</p>
                  </>
                );
                return href ? (
                  <Link
                    key={log.id}
                    href={href}
                    className="block px-5 py-3 hover:bg-[#F8F8F6] transition-colors"
                  >
                    {inner}
                  </Link>
                ) : (
                  <div key={log.id} className="px-5 py-3">
                    {inner}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Expiring memberships */}
        {expiringMembers && expiringMembers.length > 0 && (
          <Card padding={false}>
            <div className="px-5 py-4 border-b border-[#E4E4DE] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-[#F06418]" />
              <h3 className="text-base font-semibold text-[#1A1A16]">
                Memberships Expiring Soon ({expiringMembers.length})
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-[#F8F8F6]">
                  <tr>
                    <th className="text-left text-xs font-semibold text-[#7A7A72] px-5 py-2.5">Member</th>
                    <th className="text-left text-xs font-semibold text-[#7A7A72] px-5 py-2.5">Package</th>
                    <th className="text-left text-xs font-semibold text-[#7A7A72] px-5 py-2.5">Expiry</th>
                    <th className="text-left text-xs font-semibold text-[#7A7A72] px-5 py-2.5">Phone</th>
                    <th className="text-left text-xs font-semibold text-[#7A7A72] px-5 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E4E4DE]">
                  {expiringMembers.map((member: any) => {
                    const { label, variant } = getMemberStatusDisplay(member.status, member.expiry_date);
                    return (
                      <tr key={member.id} className="hover:bg-[#F8F8F6]">
                        <td className="px-5 py-3 text-sm font-medium text-[#1A1A16]">{member.full_name}</td>
                        <td className="px-5 py-3 text-sm text-[#4A4A44]">{member.packages?.name ?? "—"}</td>
                        <td className="px-5 py-3 text-sm text-[#4A4A44]">{formatDate(member.expiry_date)}</td>
                        <td className="px-5 py-3 text-sm text-[#4A4A44]">{member.phone}</td>
                        <td className="px-5 py-3">
                          <Badge variant={variant}>{label}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
