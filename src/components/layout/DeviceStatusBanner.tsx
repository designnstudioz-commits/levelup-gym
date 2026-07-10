"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { isDeviceOnline, timeAgo } from "@/lib/utils";
import type { Device } from "@/types/database";

// Polls every 60s so a device going down anywhere shows up on every
// dashboard page, not just the Attendance page's own passive badge.
export function DeviceStatusBanner() {
  const [devices, setDevices] = useState<Device[]>([]);

  useEffect(() => {
    const supabase = createClient();
    function fetchDevices() {
      supabase.from("devices").select("*").then(({ data }) => setDevices(data ?? []));
    }
    fetchDevices();
    const interval = setInterval(fetchDevices, 60_000);
    return () => clearInterval(interval);
  }, []);

  const offlineDevices = devices.filter((d) => !isDeviceOnline(d.last_seen));

  if (offlineDevices.length === 0) return null;

  return (
    <div className="sticky top-0 z-20 bg-red-50 border-b border-red-200 px-4 py-2 flex flex-wrap items-center gap-2">
      <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
      {offlineDevices.map((d) => (
        <span key={d.id} className="text-xs font-medium text-red-700">
          {d.name} is offline{d.last_seen ? ` — last seen ${timeAgo(d.last_seen)}` : " — never connected"}
        </span>
      ))}
    </div>
  );
}
