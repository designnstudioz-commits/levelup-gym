import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { RegistrationForm } from "@/components/forms/registration";

export default async function DashboardRegisterPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Fetch system_user profile for currentUser
  const { data: systemUser } = await supabase
    .from("system_users")
    .select("*")
    .eq("email", user.email!)
    .eq("status", "active")
    .is("deleted_at", null)
    .single();

  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader
        title="Add New Member"
        subtitle="Staff registration — all fields available"
      />
      <div className="flex-1 p-6">
        <div className="max-w-3xl mx-auto">
          <div className="bg-white rounded-2xl border border-[#E4E4DE] p-6 sm:p-8">
            <RegistrationForm mode="staff" currentUser={systemUser} />
          </div>
        </div>
      </div>
    </div>
  );
}
