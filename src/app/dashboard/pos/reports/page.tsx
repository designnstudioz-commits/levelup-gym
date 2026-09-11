"use client";

import Link from "next/link";
import { CalendarDays, ShoppingBag, Wallet, UserCog, Warehouse, Salad, Layers } from "lucide-react";
import { useRoleGuard } from "@/hooks/useRoleGuard";
import { DashboardHeader } from "@/components/layout/DashboardHeader";

const REPORTS = [
  { label: "Daily Business Report", href: "/dashboard/pos/reports/daily", icon: CalendarDays, hint: "Membership + POS, by department, payment method and cash — for one day" },
  { label: "POS Sales Report", href: "/dashboard/pos/reports/sales", icon: ShoppingBag, hint: "Filterable — date range, department, product, cashier, status" },
  { label: "Payment Method Report", href: "/dashboard/pos/reports/payment-methods", icon: Wallet, hint: "Cash, Card, Bank, EasyPaisa, JazzCash — split payments handled correctly" },
  { label: "Cashier / Shift Report", href: "/dashboard/pos/reports/cashiers", icon: UserCog, hint: "Sessions, cash variance, and refund/void exceptions" },
  { label: "Inventory Report", href: "/dashboard/pos/inventory", icon: Warehouse, hint: "Stock, alerts and movement history — the existing Phase E screens" },
  { label: "HealthBox Report", href: "/dashboard/pos/healthbox/report", icon: Salad, hint: "Sales, expenses, and profit/loss — Owner/Manager only" },
  { label: "Combined Business Report", href: "/dashboard/pos/reports/combined", icon: Layers, hint: "Cash collected vs. revenue Level Up actually owns" },
];

export default function PosReportsHubPage() {
  useRoleGuard(["owner", "manager"]);

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader title="POS Reports" subtitle="Financial and operational reporting across membership, POS and HealthBox" />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {REPORTS.map((r) => (
            <Link key={r.href} href={r.href} className="bg-white border border-[#E4E4DE] rounded-xl p-5 flex items-start gap-4 hover:border-[#F06418] transition-colors">
              <div className="w-10 h-10 rounded-lg bg-[#FEF0E8] flex items-center justify-center flex-shrink-0">
                <r.icon className="w-5 h-5 text-[#F06418]" />
              </div>
              <div>
                <p className="text-sm font-bold text-[#1A1A16]">{r.label}</p>
                <p className="text-xs text-[#7A7A72] mt-0.5">{r.hint}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
