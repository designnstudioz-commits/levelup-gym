"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { useCurrentUser } from "@/contexts/CurrentUserContext";
import { Badge } from "@/components/ui/Badge";

/**
 * The terminal's top bar.
 *
 * Structure follows the approved Figma frame — brand lockup and screen
 * title on the left, shift state, operator and clock on the right — but
 * every colour, font and component comes from the existing Level Up design
 * system, not from the Figma's temporary black/green styling. The dark bar
 * is #1A1A1A, the same value the management sidebar already uses, so the
 * terminal reads as part of the same product.
 */
export function PosTopBar({
  title,
  shiftOpen = false,
}: {
  title: string;
  shiftOpen?: boolean;
}) {
  const currentUser = useCurrentUser();

  // Rendered client-side only. A server-rendered clock would hydrate with a
  // stale time and, because the server is UTC while the gym reads PKT,
  // briefly show the wrong hour.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const roleLabel = currentUser?.role
    ? currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1).replace("_", " ")
    : "—";

  // A cashier is redirected straight back here by the dashboard layout, so
  // offering them a dashboard link would just bounce. They sign out instead.
  const isCashier = currentUser?.role === "cashier";

  return (
    <header className="no-print bg-[#1A1A1A] flex items-center justify-between gap-4 px-6 h-[72px] flex-shrink-0">
      <div className="flex items-center gap-4 min-w-0">
        <Link href="/pos" className="flex items-center gap-2.5 flex-shrink-0">
          <div className="w-9 h-9 bg-[#F06418] rounded-lg flex items-center justify-center">
            <span className="text-white text-xs font-black">LU</span>
          </div>
          <span className="text-white/40 text-[10px] font-bold uppercase tracking-[0.18em]">
            POS
          </span>
        </Link>
        <div className="h-8 w-px bg-white/10 flex-shrink-0" />
        <h1 className="text-white text-lg font-bold font-[family-name:var(--font-barlow-condensed)] uppercase tracking-wide truncate">
          {title}
        </h1>
      </div>

      <div className="flex items-center gap-4 flex-shrink-0">
        <Badge variant={shiftOpen ? "active" : "inactive"}>
          {shiftOpen ? "Shift open" : "No shift"}
        </Badge>

        <div className="hidden sm:block text-right leading-tight">
          <p className="text-white text-sm font-semibold truncate max-w-[180px]">
            {currentUser?.full_name ?? "Staff"}
          </p>
          <p className="text-white/40 text-xs">{roleLabel}</p>
        </div>

        <div className="hidden md:block h-8 w-px bg-white/10" />

        {/* suppressHydrationWarning: null on the server by design, see above */}
        <p
          className="hidden md:block text-white/70 text-sm font-semibold tabular-nums w-[68px] text-right"
          suppressHydrationWarning
        >
          {now
            ? now.toLocaleTimeString("en-PK", { hour: "numeric", minute: "2-digit" })
            : ""}
        </p>

        <Link
          href={isCashier ? "/login" : "/dashboard"}
          className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-white/60 hover:bg-white/10 hover:text-white transition-colors"
          title={isCashier ? "Sign out" : "Back to dashboard"}
          aria-label={isCashier ? "Sign out" : "Back to dashboard"}
        >
          <LogOut className="w-5 h-5" />
        </Link>
      </div>
    </header>
  );
}
