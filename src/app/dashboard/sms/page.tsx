import { MessageSquare } from "lucide-react";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { ComingSoon } from "@/components/ui/ComingSoon";

export default function SmsPage() {
  return (
    <div className="flex flex-col flex-1">
      <DashboardHeader title="SMS & Notifications" subtitle="Send messages to members" />
      <ComingSoon
        title="SMS & WhatsApp"
        icon={MessageSquare}
        description="Send bulk SMS via Telenor CCSMS, WhatsApp messages via WATI, and automated fee reminders to members."
        phase="Phase 2"
      />
    </div>
  );
}
