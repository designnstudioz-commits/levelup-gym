"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  UserPlus,
  UserCheck,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { SystemRole } from "@/types/database";

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
  userName?: string;
  userRole?: string;
}

const NAV_ROLES: Record<string, SystemRole[]> = {
  "/dashboard":             ["owner", "manager", "receptionist", "viewer"],
  "/dashboard/members":     ["owner", "manager", "receptionist", "viewer"],
  "/dashboard/submissions": ["owner", "manager", "receptionist"],
  "/dashboard/attendance":  ["owner", "manager", "receptionist", "trainer"],
  "/dashboard/fees":        ["owner", "manager", "receptionist"],
  "/dashboard/packages":    ["owner", "manager"],
  "/dashboard/staff":       ["owner", "manager"],
  "/dashboard/reports":     ["owner", "manager"],
  "/dashboard/sms":         ["owner", "manager", "receptionist"],
  "/dashboard/settings":    ["owner"],
};

function canAccess(href: string, role: string): boolean {
  const allowed = NAV_ROLES[href];
  if (!allowed) return true;
  return allowed.includes(role as SystemRole);
}

// Portal tooltip — renders into document.body so overflow on the sidebar never clips it
function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  function handleEnter() {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setCoords({ top: r.top + r.height / 2, left: r.right + 10 });
  }

  function handleLeave() { setCoords(null); }

  return (
    <div ref={ref} onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      {children}
      {coords && createPortal(
        <div
          style={{ position: "fixed", top: coords.top, left: coords.left, transform: "translateY(-50%)", zIndex: 9999, pointerEvents: "none" }}
        >
          <div style={{ background: "#111", color: "#fff", fontSize: 12, fontWeight: 600, padding: "6px 10px", borderRadius: 8, whiteSpace: "nowrap", boxShadow: "0 4px 16px rgba(0,0,0,0.3)" }}>
            {label}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export function Sidebar({ pendingSubmissions = 0, userEmail, userName, userRole }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);

  // Persist collapse state across navigation
  useEffect(() => {
    const saved = localStorage.getItem("sidebar-collapsed");
    if (saved === "true") setCollapsed(true);
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      localStorage.setItem("sidebar-collapsed", String(!prev));
      return !prev;
    });
  }

  const allNavItems: NavItem[] = [
    { label: "Dashboard",      href: "/dashboard",            icon: LayoutDashboard },
    {
      label: "Members",
      href: "/dashboard/members",
      icon: Users,
      children: [
        { label: "All Members",   href: "/dashboard/members",       icon: UserCheck },
        { label: "Add Member",    href: "/dashboard/register",      icon: UserPlus  },
        { label: "Daily Members", href: "/dashboard/daily-members", icon: Users     },
      ],
    },
    { label: "Submissions",    href: "/dashboard/submissions", icon: ClipboardList, badge: pendingSubmissions },
    { label: "Attendance",     href: "/dashboard/attendance",  icon: CalendarCheck },
    { label: "Fees & Payments",href: "/dashboard/fees",        icon: CreditCard    },
    { label: "Packages",       href: "/dashboard/packages",    icon: Package       },
    {
      label: "Staff & Trainers",
      href: "/dashboard/staff",
      icon: UserCog,
      children: [
        { label: "All Staff", href: "/dashboard/staff",       icon: UserCog  },
        { label: "Add Staff", href: "/dashboard/staff?add=1", icon: UserPlus },
      ],
    },
    { label: "Reports",        href: "/dashboard/reports",    icon: BarChart2   },
    { label: "SMS & Notify",   href: "/dashboard/sms",        icon: MessageSquare },
    { label: "Settings",       href: "/dashboard/settings",   icon: Settings    },
  ];

  const navItems = allNavItems.filter((item) => canAccess(item.href, userRole ?? "viewer"));

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

  const displayName = userName ?? userEmail ?? "Staff";
  const avatarChar  = (userName ?? userEmail ?? "S").charAt(0).toUpperCase();

  const childRoutes: Record<string, string[]> = {
    "/dashboard/members": ["/dashboard/members", "/dashboard/register", "/dashboard/daily-members"],
    "/dashboard/staff":   ["/dashboard/staff"],
  };

  return (
    <aside
      className={cn(
        "bg-[#1A1A1A] flex flex-col h-full flex-shrink-0 relative transition-all duration-300 ease-in-out",
        collapsed ? "w-16" : "w-60"
      )}
    >
      {/* Logo + toggle */}
      <div className="px-3 py-4 border-b border-white/10 flex items-center justify-between min-h-[72px]">
        {!collapsed && (
          <Link href="/dashboard" className="flex-1 flex items-center justify-center overflow-hidden">
            <img src="/logo.png" alt="Level Up Fitness Club" className="h-12 w-auto object-contain" />
          </Link>
        )}
        {collapsed && (
          <Link href="/dashboard" className="flex-1 flex items-center justify-center">
            <div className="w-8 h-8 bg-[#F06418] rounded-lg flex items-center justify-center">
              <span className="text-white text-xs font-black">LU</span>
            </div>
          </Link>
        )}
        <button
          onClick={toggleCollapsed}
          className="w-6 h-6 rounded-md bg-white/10 hover:bg-white/20 flex items-center justify-center flex-shrink-0 transition-colors"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed
            ? <ChevronRight className="w-3.5 h-3.5 text-white/70" />
            : <ChevronLeft  className="w-3.5 h-3.5 text-white/70" />
          }
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto overflow-x-hidden">
        {navItems.map((item) => {
          const active = isActive(item.href);
          const Icon   = item.icon;
          const shouldExpand = !collapsed && item.children &&
            Object.entries(childRoutes).some(
              ([base, routes]) => item.href === base && routes.some((r) => pathname.startsWith(r))
            );

          // Collapsed: icon-only with tooltip
          if (collapsed) {
            return (
              <Tip key={item.href} label={item.label}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center justify-center w-full h-10 rounded-lg transition-colors relative",
                    active
                      ? "bg-[#FEF0E8] text-[#F06418]"
                      : "text-white/70 hover:bg-white/10 hover:text-white"
                  )}
                >
                  <Icon className="w-5 h-5 flex-shrink-0" />
                  {item.badge != null && item.badge > 0 && (
                    <span className="absolute top-1 right-1 bg-[#F06418] text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center leading-none">
                      {item.badge > 9 ? "9+" : item.badge}
                    </span>
                  )}
                </Link>
              </Tip>
            );
          }

          // Expanded with children (active group)
          if (shouldExpand && item.children) {
            return (
              <div key={item.href}>
                <div className={cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                  active ? "bg-[#FEF0E8] text-[#F06418] border-l-2 border-[#F06418]" : "text-white/70"
                )}>
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span className="truncate">{item.label}</span>
                </div>
                <div className="ml-4 mt-0.5 space-y-0.5">
                  {item.children.map((child) => {
                    const ChildIcon  = child.icon;
                    const childActive = pathname === child.href;
                    return (
                      <Link key={child.href} href={child.href}
                        className={cn(
                          "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                          childActive ? "bg-[#F06418] text-white" : "text-white/50 hover:bg-white/5 hover:text-white/80"
                        )}
                      >
                        <ChildIcon className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="truncate">{child.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          }

          // Expanded normal link
          return (
            <Link key={item.href} href={item.href}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                active ? "bg-[#FEF0E8] text-[#F06418]" : "text-white/70 hover:bg-white/5 hover:text-white"
              )}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1 truncate">{item.label}</span>
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
      <div className="px-2 py-4 border-t border-white/10">
        {collapsed ? (
          <>
            <Tip label={displayName}>
              <div className="flex items-center justify-center w-full h-10 rounded-lg mb-1">
                <div className="w-7 h-7 bg-[#F06418] rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-xs font-bold">{avatarChar}</span>
                </div>
              </div>
            </Tip>
            <Tip label="Sign out">
              <button onClick={handleLogout}
                className="flex items-center justify-center w-full h-10 rounded-lg text-white/60 hover:bg-white/5 hover:text-white transition-colors">
                <LogOut className="w-4 h-4" />
              </button>
            </Tip>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2.5 px-3 py-2 mb-1">
              <div className="w-7 h-7 bg-[#F06418] rounded-full flex items-center justify-center flex-shrink-0">
                <span className="text-white text-xs font-bold">{avatarChar}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-xs font-medium truncate">{displayName}</p>
                <p className="text-white/40 text-[10px] capitalize">{userRole ?? "—"}</p>
              </div>
            </div>
            <button onClick={handleLogout}
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm text-white/60 hover:bg-white/5 hover:text-white transition-colors">
              <LogOut className="w-4 h-4" />
              <span>Sign out</span>
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
