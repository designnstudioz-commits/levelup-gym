import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CurrentUserProvider } from "@/contexts/CurrentUserContext";
import { POS_TERMINAL_ROLES, hasPosAccess } from "@/lib/pos/permissions";
import type { SystemRole } from "@/types/database";

/**
 * The POS terminal shell.
 *
 * Deliberately NOT nested under src/app/dashboard: that layout ships a
 * 240px sidebar of small links plus the device-status banner, which on a
 * touch monitor is wasted space and an easy way to navigate out of a
 * half-finished sale. This is a full-bleed, chrome-free surface.
 *
 * Authorisation is enforced HERE, server-side, before anything renders.
 * The middleware only confirms there is a session; this confirms the role.
 * Both exist because the middleware would otherwise need a database
 * round-trip on every request to resolve a role.
 */
export default async function PosLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) redirect("/login");

  const { data: systemUser } = await supabase
    .from("system_users")
    .select("id, full_name, role, status, staff_id, pos_access, pos_department_scope")
    .eq("email", user.email.toLowerCase())
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();

  // An authenticated Supabase user with no active staff record is not
  // staff. Send them to the login screen rather than defaulting to a role.
  if (!systemUser?.role) redirect("/login");

  // Per-user grant first: as of 2026-09-29 a role no longer opens the
  // terminal on its own. A receptionist or manager without an explicit
  // grant is turned away here, not just hidden from the menu — nav
  // visibility never was the boundary.
  if (!hasPosAccess({
    role: systemUser.role as SystemRole,
    pos_access: systemUser.pos_access,
    pos_department_scope: systemUser.pos_department_scope,
  })) {
    redirect("/dashboard");
  }

  // Role still decides WHICH POS surfaces are reachable, so a granted
  // HealthBox staff member is sent to their scoped screens rather than the
  // till. The grant is the gate; the role is the ceiling.
  if (!POS_TERMINAL_ROLES.includes(systemUser.role as SystemRole)) {
    redirect("/dashboard");
  }

  return (
    // pos-root scopes every touch-specific CSS rule (see globals.css) so
    // none of it can leak into the management dashboard.
    <div className="pos-root flex flex-col h-screen overflow-hidden bg-[#F7F6F3]">
      <CurrentUserProvider
        value={{
          id: systemUser.id,
          full_name: systemUser.full_name,
          role: systemUser.role,
          staff_id: systemUser.staff_id,
          pos_access: systemUser.pos_access ?? false,
          pos_department_scope: systemUser.pos_department_scope ?? null,
        }}
      >
        {children}
      </CurrentUserProvider>
    </div>
  );
}
