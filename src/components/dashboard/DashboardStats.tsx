"use client";

import { useState } from "react";
import Link from "next/link";
import { Users, CalendarCheck, CreditCard, ClipboardList } from "lucide-react";
import { StatsCard } from "@/components/ui/StatsCard";
import { formatPKR, formatDate, cn } from "@/lib/utils";

export interface UnpaidMember {
  id: string;
  full_name: string;
  expiry_date: string | null;
  amount: number;
  isExpired: boolean;
}

interface DashboardStatsProps {
  paidCount: number;
  unpaidMembers: UnpaidMember[];
  totalUnpaidAmount: number;
  todayAttendanceCount: number;
  monthlyRevenue: number;
  isReceptionist: boolean;
  pendingSubmissionsCount: number;
}

export function DashboardStats({
  paidCount,
  unpaidMembers,
  totalUnpaidAmount,
  todayAttendanceCount,
  monthlyRevenue,
  isReceptionist,
  pendingSubmissionsCount,
}: DashboardStatsProps) {
  const [view, setView] = useState<"paid" | "unpaid">("paid");

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-[#E4E4DE] rounded-xl p-5">
          <div className="flex items-start justify-between gap-2">
            <div className="p-2.5 rounded-lg bg-[#FEF0E8] flex-shrink-0">
              <Users className="w-5 h-5 text-[#F06418]" strokeWidth={2} />
            </div>
            <div className="flex bg-[#F8F8F6] rounded-lg p-0.5 text-xs font-semibold flex-shrink-0">
              <button
                type="button"
                onClick={() => setView("paid")}
                className={cn(
                  "px-2 py-1 rounded-md transition",
                  view === "paid" ? "bg-white text-[#F06418] shadow-sm" : "text-[#7A7A72]"
                )}
              >
                Paid
              </button>
              <button
                type="button"
                onClick={() => setView("unpaid")}
                className={cn(
                  "px-2 py-1 rounded-md transition",
                  view === "unpaid" ? "bg-white text-[#F06418] shadow-sm" : "text-[#7A7A72]"
                )}
              >
                Unpaid
              </button>
            </div>
          </div>
          <p className="text-sm text-[#7A7A72] font-medium mt-3">
            {view === "paid" ? "Active Members (Paid)" : "Unpaid Members"}
          </p>
          <p className="text-2xl font-bold text-[#1A1A16] mt-0.5 font-[family-name:var(--font-barlow-condensed)]">
            {view === "paid" ? paidCount : unpaidMembers.length}
          </p>
          {view === "unpaid" && (
            <p className="text-xs font-semibold text-red-600 mt-1">
              {formatPKR(totalUnpaidAmount)} owed
            </p>
          )}
        </div>

        <StatsCard
          title="Today's Attendance"
          value={todayAttendanceCount}
          icon={CalendarCheck}
          iconColor="text-green-600"
          iconBg="bg-green-50"
        />
        {!isReceptionist && (
          <StatsCard
            title="Monthly Revenue"
            value={formatPKR(monthlyRevenue)}
            icon={CreditCard}
            iconColor="text-blue-600"
            iconBg="bg-blue-50"
          />
        )}
        <StatsCard
          title="Pending Submissions"
          value={pendingSubmissionsCount}
          icon={ClipboardList}
          iconColor="text-yellow-600"
          iconBg="bg-yellow-50"
        />
      </div>

      {view === "unpaid" && (
        <div className="bg-white border border-[#E4E4DE] rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-[#E4E4DE] flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#1A1A16]">
              Members With Pending Dues ({unpaidMembers.length})
            </h3>
            <Link
              href="/dashboard/fees?tab=outstanding"
              className="text-xs text-[#F06418] font-medium hover:underline"
            >
              View in Fees
            </Link>
          </div>
          {unpaidMembers.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-[#7A7A72]">
              No pending dues — everyone's paid up.
            </div>
          ) : (
            <div className="divide-y divide-[#E4E4DE] max-h-72 overflow-y-auto">
              {unpaidMembers.map((m) => (
                <Link
                  key={m.id}
                  href={`/dashboard/members/${m.id}`}
                  className="px-5 py-2.5 flex items-center justify-between gap-3 hover:bg-[#F8F8F6]"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#1A1A16] truncate">{m.full_name}</p>
                    <p className="text-xs text-[#7A7A72]">
                      {m.isExpired ? `Expired ${formatDate(m.expiry_date)}` : "No payment in 30 days"}
                    </p>
                  </div>
                  <span className="text-sm font-bold text-red-600 flex-shrink-0">
                    {formatPKR(m.amount)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
