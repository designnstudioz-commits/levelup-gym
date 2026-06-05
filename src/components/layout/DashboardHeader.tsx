"use client";

import Link from "next/link";
import { Bell, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatDate } from "@/lib/utils";

interface DashboardHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export function DashboardHeader({ title, subtitle, action }: DashboardHeaderProps) {
  const today = formatDate(new Date().toISOString());

  return (
    <header className="bg-white border-b border-[#E4E4DE] px-6 py-4 flex items-center justify-between flex-shrink-0">
      <div>
        <h1 className="text-xl font-bold text-[#1A1A16] font-[family-name:var(--font-barlow-condensed)] uppercase tracking-wide">
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm text-[#7A7A72] mt-0.5">
            {subtitle || today}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        {action ?? (
          <Link href="/dashboard/register">
            <Button size="sm">
              <Plus className="w-4 h-4" />
              Add Member
            </Button>
          </Link>
        )}
      </div>
    </header>
  );
}
