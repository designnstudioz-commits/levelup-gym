import { Settings } from "lucide-react";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { ComingSoon } from "@/components/ui/ComingSoon";

export default function SettingsPage() {
  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader title="Settings" subtitle="System configuration and user management" />
      <ComingSoon
        title="Settings"
        icon={Settings}
        description="Manage system users, roles, permissions, gym profile, and integration settings."
        phase="Phase 2"
      />
    </div>
  );
}
