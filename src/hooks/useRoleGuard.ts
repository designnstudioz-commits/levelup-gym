"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { SystemRole } from "@/types/database";

export function useRoleGuard(allowedRoles: SystemRole[]) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.replace("/login"); return; }

      supabase
        .from("system_users")
        .select("role, status")
        .eq("email", user.email!)
        .eq("status", "active")
        .is("deleted_at", null)
        .maybeSingle()
        .then(({ data }) => {
          if (!data || !allowedRoles.includes(data.role as SystemRole)) {
            router.replace("/dashboard");
          }
        });
    });
  }, []);
}
