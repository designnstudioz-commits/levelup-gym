import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/layout/Sidebar";

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
      .select("id, full_name, role, status")
      .eq("email", user.email!)
      .eq("status", "active")
      .is("deleted_at", null)
      .maybeSingle(),
  ]);

  return (
    <div className="flex h-screen overflow-hidden bg-[#F8F8F6]">
      <Sidebar
        pendingSubmissions={pendingCount ?? 0}
        userEmail={user.email}
        userName={systemUser?.full_name ?? undefined}
        userRole={systemUser?.role ?? "viewer"}
      />
      <main className="flex-1 overflow-y-auto flex flex-col">
        {children}
      </main>
    </div>
  );
}
