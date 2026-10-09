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
  AlertTriangle,
  CalendarCheck,
  CreditCard,
  Banknote,
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
  HeartHandshake,
  Percent,
  ShoppingCart,
  Boxes,
  Warehouse,
  Truck,
  Wallet,
  Receipt,
  Monitor,
  Tags,
  Building2,
  SlidersHorizontal,
  FileText,
  TrendingUp,
  Landmark,
} from "lucide-react";
import type { SystemRole } from "@/types/database";
import { POS_ROUTE_ROLES, hasPosAccess } from "@/lib/pos/permissions";

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  badge?: number;
  /** ISO date (YYYY-MM-DD) after which the NEW pill stops showing. Set it
   *  when a module ships and never touch it again — isNewFeature() retires
   *  the badge on its own, so nobody has to remember to come back and
   *  delete it. */
  newUntil?: string;
  children?: { label: string; href: string; icon: React.ElementType }[];
}

/** Whether a module should still be flagged NEW.
 *
 *  Compared as plain YYYY-MM-DD strings rather than Date objects: the cutoff
 *  is a calendar date, and `new Date("2026-10-06")` parses as UTC midnight,
 *  which in PKT (UTC+5) would retire the badge five hours early on the
 *  previous evening. String comparison is exact and timezone-free.
 *
 *  `now` is injectable so the behaviour can be tested at a simulated date
 *  without waiting for the calendar. */
/** A labelled group of nav items. `heading: null` renders the items with no
 *  heading and no divider — used only for Dashboard at the very top. */
interface NavSection {
  heading: string | null;
  items: NavItem[];
}

export function isNewFeature(newUntil?: string, now?: string): boolean {
  if (!newUntil) return false;
  const today = now ?? new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
  return today < newUntil;
}

interface SidebarProps {
  pendingSubmissions?: number;
  userEmail?: string;
  userName?: string;
  userRole?: string;
  /** Explicit per-user POS grant — role alone no longer reveals the POS
   *  menu. Owner ignores both and always sees it. */
  posAccess?: boolean;
  posDepartmentScope?: string[] | null;
}

const NAV_ROLES: Record<string, SystemRole[]> = {
  "/dashboard":             ["owner", "manager", "receptionist", "trainer", "viewer"],
  "/dashboard/members":     ["owner", "manager", "receptionist", "viewer"],
  "/dashboard/submissions": ["owner", "manager", "receptionist"],
  "/dashboard/attendance":  ["owner", "manager", "receptionist", "trainer"],
  "/dashboard/fees":        ["owner", "manager", "receptionist"],
  // Owner only — the page shows Net Profit, which is management
  // information. Matches the "owner read expenses" RLS policy and
  // EXPENSE_VIEW_ROLES exactly. Must be listed: canAccess() fails OPEN, so
  // an unlisted route would appear for every role.
  "/dashboard/expenses":    ["owner"],
  "/dashboard/packages":    ["owner", "manager"],
  "/dashboard/family-approvals": ["owner", "manager"],
  "/dashboard/staff":       ["owner", "manager"],
  "/dashboard/commissions": ["owner", "manager"],
  "/dashboard/reports":     ["owner", "manager"],
  "/dashboard/sms":         ["owner", "manager", "receptionist"],
  "/dashboard/settings":    ["owner"],

  // Phase 3 POS routes are spread in from the single source of truth in
  // src/lib/pos/permissions.ts rather than restated here. Duplicating them
  // would mean two lists that drift, and given canAccess() fails open
  // (below), a route missing from this map becomes visible to EVERY role —
  // including the two new ones. One list, imported.
  ...POS_ROUTE_ROLES,
};

// NOTE: this returns true for any href not present in NAV_ROLES — it fails
// OPEN. That is pre-existing behaviour relied on by unlisted routes such as
// /dashboard/register and /dashboard/staff?add=1, so it is not changed here.
// The consequence to remember: every NEW route must be added to NAV_ROLES
// or it is shown to all roles. All POS routes are covered by the spread
// above, and POS pages additionally enforce their own access server-side —
// this function is cosmetic, never the security boundary.
function canAccess(href: string, role: string, posOk: boolean): boolean {
  // POS is gated per user, not per role (see src/lib/pos/permissions.ts).
  // Checked before the role map so a receptionist or manager without an
  // explicit grant never sees the menu, even though their role still appears
  // in POS_ROUTE_ROLES — that list is now a ceiling on what they may do once
  // granted, not the grant itself.
  if (href === "/pos" || href === "/dashboard/pos" || href.startsWith("/dashboard/pos/")) {
    if (!posOk) return false;
  }
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

export function Sidebar({ pendingSubmissions = 0, userEmail, userName, userRole, posAccess, posDepartmentScope }: SidebarProps) {
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

  // The nav is grouped so a page can be found by what it is about rather than
  // by scanning one long list. Point of Sale was the first section (split out
  // on 2026-09-29); the rest follow the same shape.
  //
  // Grouping is DATA, not layout: adding or moving an entry means editing a
  // list here, and a heading disappears on its own when a role can see
  // nothing inside it — see visibleSections below. No route, page or
  // permission changes when this list is reordered.
  const mainSections: NavSection[] = [
    // Ungrouped, pinned at the top. A heading above a single Dashboard link
    // would be noise.
    {
      heading: null,
      items: [{ label: "Dashboard", href: "/dashboard", icon: LayoutDashboard }],
    },
    {
      // "Members" used to be a collapsible group holding All/Add/Daily. With
      // a heading above them that wrapper was doing the same job twice, so
      // the three are flat now and reachable in one click.
      heading: "Members",
      items: [
        { label: "All Members",      href: "/dashboard/members",          icon: UserCheck },
        { label: "Add Member",       href: "/dashboard/register",         icon: UserPlus },
        { label: "Daily Members",    href: "/dashboard/daily-members",    icon: Users },
        { label: "Submissions",      href: "/dashboard/submissions",      icon: ClipboardList, badge: pendingSubmissions },
        { label: "Family Approvals", href: "/dashboard/family-approvals", icon: HeartHandshake },
        { label: "Attendance",       href: "/dashboard/attendance",       icon: CalendarCheck },
      ],
    },
    {
      heading: "Money",
      items: [
        { label: "Fees & Payments",     href: "/dashboard/fees",        icon: CreditCard },
        { label: "Packages",            href: "/dashboard/packages",    icon: Package },
        // Shipped 2026-09-29; the pill retires itself on 2026-10-06.
        { label: "Expenses",            href: "/dashboard/expenses",    icon: Banknote, newUntil: "2026-10-06" },
        { label: "Trainer Commissions", href: "/dashboard/commissions", icon: Percent },
        { label: "Reports",             href: "/dashboard/reports",     icon: BarChart2 },
      ],
    },
  ];

  const adminSection: NavSection = {
    heading: "Admin",
    items: [
      {
        label: "Staff & Trainers",
        href: "/dashboard/staff",
        icon: UserCog,
        children: [
          { label: "All Staff", href: "/dashboard/staff",       icon: UserCog  },
          { label: "Add Staff", href: "/dashboard/staff?add=1", icon: UserPlus },
        ],
      },
      { label: "SMS & Notify", href: "/dashboard/sms",      icon: MessageSquare },
      { label: "Settings",     href: "/dashboard/settings", icon: Settings },
    ],
  };

  // POS lives in its own section BELOW Settings, split out of the former
  // combined "POS & Inventory" group. Every href below already existed — no
  // page was created, moved or duplicated, only regrouped.
  //
  // Permissions are untouched: this list goes through exactly the same
  // canAccess() + hasPosAccess() filter as the main list, so a user without
  // an explicit POS grant sees the whole section disappear.
  const posNavItems: NavItem[] = [
    {
      label: "POS",
      href: "/dashboard/pos",
      icon: ShoppingCart,
      children: [
        { label: "Overview",      href: "/dashboard/pos",                     icon: LayoutDashboard },
        { label: "Orders",        href: "/dashboard/pos/orders",              icon: Receipt         },
        { label: "Products",      href: "/dashboard/pos/catalog/products",    icon: Boxes           },
        { label: "Categories",    href: "/dashboard/pos/catalog/categories",  icon: Tags            },
        { label: "Departments",   href: "/dashboard/pos/catalog/departments", icon: Building2       },
        { label: "Modifiers",     href: "/dashboard/pos/catalog/modifiers",   icon: SlidersHorizontal },
        { label: "Suppliers",     href: "/dashboard/pos/suppliers",         icon: Truck           },
        { label: "Cash Sessions", href: "/dashboard/pos/sessions",          icon: Wallet          },
        { label: "POS Reports",   href: "/dashboard/pos/reports",           icon: BarChart2       },
        // Phase H nav cleanup: a separate "HealthBox" entry pointing at
        // /dashboard/pos/catalog/products used to sit here — identical
        // href to "Products" above, so it was a pure duplicate destination
        // once HealthBox Expenses/Report/Settlement (below) existed as
        // their own real, distinct pages. Removed rather than kept as a
        // second link to the same place. healthbox_staff still land on
        // Products directly (middleware.ts, dashboard/page.tsx,
        // permissions.ts) — that mapping is unchanged, just not
        // double-listed in the sidebar too.
        { label: "HealthBox Expenses", href: "/dashboard/pos/healthbox/expenses", icon: FileText  },
        { label: "HealthBox Report", href: "/dashboard/pos/healthbox/report", icon: TrendingUp    },
        { label: "HealthBox Settlement", href: "/dashboard/pos/healthbox/settlement", icon: Landmark },
      ],
    },
    {
      label: "Inventory",
      href: "/dashboard/pos/inventory",
      icon: Warehouse,
      children: [
        { label: "Overview",    href: "/dashboard/pos/inventory",             icon: Warehouse },
        { label: "Receive",     href: "/dashboard/pos/inventory/receive",     icon: Truck     },
        { label: "Adjustments", href: "/dashboard/pos/inventory/adjustments", icon: SlidersHorizontal },
        { label: "Counts",      href: "/dashboard/pos/inventory/counts",      icon: ClipboardList },
        { label: "Movements",   href: "/dashboard/pos/inventory/movements",   icon: TrendingUp },
        { label: "Alerts",      href: "/dashboard/pos/inventory/alerts",      icon: AlertTriangle },
      ],
    },
    // Jump straight to the touch terminal.
    { label: "Open POS Terminal", href: "/pos", icon: Monitor },
  ];

  // Filter the group itself, then its children. Child filtering is new in
  // Phase 3: previously only top-level items were checked, which was fine
  // while every child shared its parent's permissions. The POS group breaks
  // that — HealthBox staff may open Catalog and HealthBox but not Orders,
  // Suppliers, Cash Sessions or POS Reports — so an unfiltered child list
  // would offer them links that bounce.
  //
  // Existing groups are unaffected: their children (/dashboard/register,
  // /dashboard/staff?add=1) are absent from NAV_ROLES, so canAccess returns
  // true for them exactly as before.
  const role = userRole ?? "viewer";
  const posOk = hasPosAccess({
    role: role as SystemRole,
    pos_access: posAccess,
    pos_department_scope: posDepartmentScope,
  });
  // One filter, applied to every section — so a new section cannot
  // accidentally skip the permission check by forgetting to call it.
  const visibleItems = (items: NavItem[]) =>
    items
      .filter((item) => canAccess(item.href, role, posOk))
      .map((item) =>
        item.children
          ? { ...item, children: item.children.filter((c) => canAccess(c.href, role, posOk)) }
          : item
      )
      // A group whose children were all filtered away has nothing to show.
      .filter((item) => !item.children || item.children.length > 0);

  // Every section, in display order, with anything this role cannot reach
  // removed — and then any section left with nothing in it dropped entirely.
  // That is why a receptionist sees no "Money" heading at all rather than an
  // empty one: every page under it is manager-or-owner.
  const visibleSections: NavSection[] = [
    ...mainSections,
    { heading: "Point of Sale", items: posNavItems },
    adminSection,
  ]
    .map((section) => ({ ...section, items: visibleItems(section.items) }))
    .filter((section) => section.items.length > 0);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    toast.success("Signed out");
    router.push("/login");
  }

  const topLevelHrefs = [
    ...mainSections.flatMap((s) => s.items),
    ...posNavItems,
    ...adminSection.items,
  ]
    .map((i) => i.href)
    .filter((h) => h !== "/dashboard");

  function isActive(href: string) {
    if (href === "/dashboard") return pathname === "/dashboard";
    if (!pathname.startsWith(href)) return false;
    // /dashboard/pos and /dashboard/pos/inventory both match an inventory
    // path; only the longest one counts as active.
    const best = topLevelHrefs
      .filter((h) => pathname.startsWith(h))
      .sort((a, b) => b.length - a.length)[0];
    return href === best;
  }

  const displayName = userName ?? userEmail ?? "Staff";
  const avatarChar  = (userName ?? userEmail ?? "S").charAt(0).toUpperCase();

  const childRoutes: Record<string, string[]> = {
    "/dashboard/staff":   ["/dashboard/staff"],
    "/dashboard/pos":     ["/dashboard/pos"],
    "/dashboard/pos/inventory": ["/dashboard/pos/inventory"],
  };

  // POS and Inventory are siblings that share a URL prefix, so a plain
  // startsWith would open/highlight both on an inventory page. Resolve the
  // most specific match once and let only that row win.
  const groupBases = Object.entries(childRoutes)
    .filter(([, routes]) => routes.some((r) => pathname.startsWith(r)))
    .map(([base]) => base)
    .sort((a, b) => b.length - a.length);
  const expandedBase = groupBases[0];

  // Headings are flattened into the same list as the items so there is one
  // renderer below rather than a copy per section. A heading row is just a
  // row that happens to draw a rule and a label.
  type NavRow = NavItem | { heading: string };
  const navRows: NavRow[] = visibleSections.flatMap((section) =>
    section.heading ? [{ heading: section.heading }, ...section.items] : section.items
  );

  return (
    <aside
      className={cn(
        "no-print bg-[#1A1A1A] flex flex-col h-full flex-shrink-0 relative transition-all duration-300 ease-in-out",
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
        {navRows.map((item) => {
          if ("heading" in item) {
            // Collapsed to icons there is no room for a label, so the rule
            // alone carries the grouping.
            return (
              <div key={`heading-${item.heading}`} className="pt-3 mt-3 border-t border-white/10">
                {!collapsed && (
                  <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-white/35">
                    {item.heading}
                  </div>
                )}
              </div>
            );
          }

          const active = isActive(item.href);
          const Icon   = item.icon;
          const shouldExpand = !collapsed && !!item.children && item.href === expandedBase;

          // Collapsed: icon-only with tooltip
          if (collapsed) {
            return (
              <Tip key={item.href} label={isNewFeature(item.newUntil) ? `${item.label} — NEW` : item.label}>
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
                  {isNewFeature(item.newUntil) && item.badge == null && (
                    <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[#F06418]" />
                  )}
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
                  {isNewFeature(item.newUntil) && (
                    <span className="bg-[#F06418] text-white text-[9px] font-bold px-1.5 py-px rounded-full leading-none tracking-wide flex-shrink-0">
                      NEW
                    </span>
                  )}
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
              {isNewFeature(item.newUntil) && (
                // text-[9px] + py-px + leading-none keeps the pill inside the
                // existing row height rather than pushing every row taller.
                <span className="bg-[#F06418] text-white text-[9px] font-bold px-1.5 py-px rounded-full leading-none tracking-wide flex-shrink-0">
                  NEW
                </span>
              )}
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
