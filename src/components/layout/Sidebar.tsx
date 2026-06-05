"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import {
  LayoutDashboard,
  Users,
  ClipboardList,
  CalendarCheck,
  CreditCard,
  Package,
  UserCog,
  BarChart2,
  MessageSquare,
  Settings,
  LogOut,
  Dumbbell,
  UserPlus,
  UserCheck,
} from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  badge?: number;
  children?: { label: string; href: string; icon: React.ElementType }[];
}

interface SidebarProps {
  pendingSubmissions?: number;
  userEmail?: string;
  userRole?: string;
}

export function Sidebar({ pendingSubmissions = 0, userEmail, userRole }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const navItems: NavItem[] = [
    {
      label: "Dashboard",
      href: "/dashboard",
      icon: LayoutDashboard,
    },
    {
      label: "Members",
      href: "/dashboard/members",
      icon: Users,
      children: [
        { label: "All Members", href: "/dashboard/members", icon: UserCheck },
        { label: "Add Member", href: "/dashboard/register", icon: UserPlus },
        { label: "Daily Members", href: "/dashboard/daily-members", icon: Users },
      ],
    },
    {
      label: "Submissions",
      href: "/dashboard/submissions",
      icon: ClipboardList,
      badge: pendingSubmissions,
    },
    {
      label: "Attendance",
      href: "/dashboard/attendance",
      icon: CalendarCheck,
    },
    {
      label: "Fees & Payments",
      href: "/dashboard/fees",
      icon: CreditCard,
    },
    {
      label: "Packages",
      href: "/dashboard/packages",
      icon: Package,
    },
    {
      label: "Staff & Trainers",
      href: "/dashboard/staff",
      icon: UserCog,
      children: [
        { label: "All Staff", href: "/dashboard/staff", icon: UserCog },
        { label: "Add Staff", href: "/dashboard/staff?add=1", icon: UserPlus },
      ],
    },
    {
      label: "Reports",
      href: "/dashboard/reports",
      icon: BarChart2,
    },
    {
      label: "SMS & Notify",
      href: "/dashboard/sms",
      icon: MessageSquare,
    },
    {
      label: "Settings",
      href: "/dashboard/settings",
      icon: Settings,
    },
  ];

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    toast.success("Signed out");
    router.push("/login");
  }

  function isActive(href: string) {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  }

  return (
    <aside className="w-60 bg-[#1A1A1A] flex flex-col h-full flex-shrink-0">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-white/10">
        <Link href="/dashboard" className="flex items-center justify-center">
          <img
            src="/logo.png"
            alt="Level Up Fitness Club"
            className="h-12 w-auto object-contain"
          />
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;

          const childRoutes: Record<string, string[]> = {
            "/dashboard/members": ["/dashboard/members", "/dashboard/register", "/dashboard/daily-members"],
            "/dashboard/staff": ["/dashboard/staff"],
          };
          const shouldExpand = item.children && Object.entries(childRoutes).some(
            ([base, routes]) => item.href === base && routes.some((r) => pathname.startsWith(r))
          );

          if (shouldExpand && item.children) {
            return (
              <div key={item.href}>
                <div
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                    active
                      ? "bg-[#FEF0E8] text-[#F06418] border-l-2 border-[#F06418]"
                      : "text-white/70 hover:bg-white/5 hover:text-white"
                  )}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span>{item.label}</span>
                </div>
                <div className="ml-4 mt-0.5 space-y-0.5">
                  {item.children.map((child) => {
                    const ChildIcon = child.icon;
                    const childActive = pathname === child.href;
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={cn(
                          "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                          childActive
                            ? "bg-[#F06418] text-white"
                            : "text-white/50 hover:bg-white/5 hover:text-white/80"
                        )}
                      >
                        <ChildIcon className="w-3.5 h-3.5 flex-shrink-0" />
                        {child.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                active
                  ? "bg-[#FEF0E8] text-[#F06418]"
                  : "text-white/70 hover:bg-white/5 hover:text-white"
              )}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1">{item.label}</span>
              {item.badge != null && item.badge > 0 && (
                <span className="bg-[#F06418] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-none">
                  {item.badge > 99 ? "99+" : item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* User section */}
      <div className="px-3 py-4 border-t border-white/10">
        <div className="flex items-center gap-2.5 px-3 py-2 mb-1">
          <div className="w-7 h-7 bg-[#F06418] rounded-full flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-bold">
              {userEmail?.charAt(0).toUpperCase() ?? "U"}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-xs font-medium truncate">{userEmail ?? "Staff"}</p>
            <p className="text-white/40 text-[10px] capitalize">{userRole ?? "—"}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm text-white/60 hover:bg-white/5 hover:text-white transition-colors"
        >
          <LogOut className="w-4 h-4" />
          <span>Sign out</span>
        </button>
      </div>
    </aside>
  );
}
