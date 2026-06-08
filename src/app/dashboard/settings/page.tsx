import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { SettingsClient } from "./SettingsClient";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: systemUser } = await supabase
    .from("system_users")
    .select("id, role, full_name")
    .eq("email", user.email!)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();

  if (!systemUser || systemUser.role !== "owner") {
    redirect("/dashboard");
  }

  const { data: staffMembers } = await supabase
    .from("staff_members")
    .select("id, full_name, role")
    .eq("status", "active")
    .is("deleted_at", null)
    .order("full_name");

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title="Settings"
        subtitle="User accounts, role permissions, and activity logs"
      />
      <SettingsClient
        currentUserId={systemUser.id}
        staffMembers={staffMembers ?? []}
      />
    </div>
  );
}
