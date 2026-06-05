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

  // Fetch pending submissions count for sidebar badge
  const { count: pendingCount } = await supabase
    .from("submissions")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending")
    .is("deleted_at", null);

  return (
    <div className="flex h-screen overflow-hidden bg-[#F8F8F6]">
      <Sidebar
        pendingSubmissions={pendingCount ?? 0}
        userEmail={user.email}
        userRole={user.user_metadata?.role ?? "staff"}
      />
      <main className="flex-1 overflow-y-auto flex flex-col">
        {children}
      </main>
    </div>
  );
}
