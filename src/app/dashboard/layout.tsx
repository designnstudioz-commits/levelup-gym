import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/layout/Sidebar";
import { CurrentUserProvider } from "@/contexts/CurrentUserContext";
import { DeviceStatusBanner } from "@/components/layout/DeviceStatusBanner";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [{ count: pendingCount }, { data: systemUser }] = await Promise.all([
    supabase
      .from("submissions")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending")
      .is("deleted_at", null),
    supabase
      .from("system_users")
      .select("id, full_name, role, status, staff_id")
      .eq("email", user.email!.toLowerCase())
      .eq("status", "active")
      .is("deleted_at", null)
      .maybeSingle(),
  ]);

  // Phase 3: a cashier's workplace is the touch terminal. Redirect before
  // rendering rather than relying on the sidebar to hide links — a direct
  // URL or an old bookmark walks straight past nav visibility, which is the
  // pre-existing weakness this must not repeat.
  //
  // Safe to do unconditionally for the whole /dashboard tree: no POS admin
  // route admits a cashier (see POS_ROUTE_ROLES), so there is nothing under
  // /dashboard for them to reach and no redirect loop is possible.
  //
  // healthbox_staff are deliberately NOT redirected here. They legitimately
  // use /dashboard/pos/* pages, and a layout cannot see the pathname in the
  // App Router, so an unconditional redirect would loop them on their own
  // landing page. Their routing is handled in dashboard/page.tsx instead.
  if (systemUser?.role === "cashier") redirect("/pos");

  return (
    <div className="flex h-screen overflow-hidden bg-[#F8F8F6]">
      <Sidebar
        pendingSubmissions={pendingCount ?? 0}
        userEmail={user.email}
        userName={systemUser?.full_name ?? undefined}
        userRole={systemUser?.role ?? "viewer"}
      />
      <main className="flex-1 overflow-y-auto flex flex-col">
        <CurrentUserProvider value={systemUser ? { id: systemUser.id, full_name: systemUser.full_name, role: systemUser.role, staff_id: systemUser.staff_id } : null}>
          <DeviceStatusBanner />
          {children}
        </CurrentUserProvider>
      </main>
    </div>
  );
}
