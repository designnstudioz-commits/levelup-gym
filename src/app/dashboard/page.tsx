import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Users,
  CalendarCheck,
  CreditCard,
  ClipboardList,
  Plus,
  ArrowRight,
  AlertCircle,
  Clock,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { StatsCard } from "@/components/ui/StatsCard";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatDate, formatPKR, timeAgo, getMemberStatusDisplay } from "@/lib/utils";
import type { MemberWithJoins, SubmissionWithJoins } from "@/types/database";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const today = new Date().toISOString().split("T")[0];
  const monthStart = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-01`;

  // Fetch all dashboard data in parallel
  const [
    { count: activeMembersCount },
    { count: todayAttendanceCount },
    { data: monthlyRevenueData },
    { count: pendingSubmissionsCount },
    { data: recentSubmissions },
    { data: expiringMembers },
    { data: recentActivity },
  ] = await Promise.all([
    supabase
      .from("members")
      .select("*", { count: "exact", head: true })
      .eq("status", "active")
      .is("deleted_at", null),

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
      .from("submissions")
      .select("id, full_name, phone, gender, status, created_at, package_id, packages(name)")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(5),

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
      .select("id, action, description, entity_type, created_at")
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const monthlyRevenue =
    monthlyRevenueData?.reduce((sum, row) => sum + (row.amount ?? 0), 0) ?? 0;

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title="Dashboard"
        subtitle={`Today — ${formatDate(new Date().toISOString())}`}
      />

      <div className="flex-1 p-6 space-y-6">
        {/* Stats row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard
            title="Active Members"
            value={activeMembersCount ?? 0}
            icon={Users}
            iconColor="text-[#F06418]"
            iconBg="bg-[#FEF0E8]"
          />
          <StatsCard
            title="Today's Attendance"
            value={todayAttendanceCount ?? 0}
            icon={CalendarCheck}
            iconColor="text-green-600"
            iconBg="bg-green-50"
          />
          <StatsCard
            title="Monthly Revenue"
            value={formatPKR(monthlyRevenue)}
            icon={CreditCard}
            iconColor="text-blue-600"
            iconBg="bg-blue-50"
          />
          <StatsCard
            title="Pending Submissions"
            value={pendingSubmissionsCount ?? 0}
            icon={ClipboardList}
            iconColor="text-yellow-600"
            iconBg="bg-yellow-50"
          />
        </div>

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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Recent submissions */}
          <div className="lg:col-span-2">
            <Card padding={false}>
              <div className="px-5 py-4 border-b border-[#E4E4DE] flex items-center justify-between">
                <h3 className="text-base font-semibold text-[#1A1A16]">Recent Submissions</h3>
                <Link
                  href="/dashboard/submissions"
                  className="text-xs text-[#F06418] font-medium flex items-center gap-1 hover:underline"
                >
                  View all <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
              {!recentSubmissions?.length ? (
                <div className="px-5 py-10 text-center text-sm text-[#7A7A72]">
                  No submissions yet
                </div>
              ) : (
                <div className="divide-y divide-[#E4E4DE]">
                  {recentSubmissions.map((sub: any) => (
                    <div key={sub.id} className="px-5 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#1A1A16] truncate">{sub.full_name}</p>
                        <p className="text-xs text-[#7A7A72]">
                          {sub.phone} · {sub.packages?.name ?? "No package"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Badge variant={sub.status as any}>{sub.status}</Badge>
                        <span className="text-xs text-[#7A7A72]">{timeAgo(sub.created_at)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Activity log */}
          <div>
            <Card padding={false}>
              <div className="px-5 py-4 border-b border-[#E4E4DE]">
                <h3 className="text-base font-semibold text-[#1A1A16]">Recent Activity</h3>
              </div>
              {!recentActivity?.length ? (
                <div className="px-5 py-10 text-center text-sm text-[#7A7A72]">No activity yet</div>
              ) : (
                <div className="divide-y divide-[#E4E4DE]">
                  {recentActivity.map((log: any) => (
                    <div key={log.id} className="px-5 py-3">
                      <p className="text-xs text-[#1A1A16] leading-snug">{log.description}</p>
                      <p className="text-[10px] text-[#7A7A72] mt-0.5">{timeAgo(log.created_at)}</p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>

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
