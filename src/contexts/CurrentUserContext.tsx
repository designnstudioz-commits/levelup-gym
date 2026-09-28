"use client";

import { createContext, useContext } from "react";
import type { SystemRole } from "@/types/database";

export interface CurrentUser {
  id: string;
  full_name: string | null;
  role: SystemRole | null;
  staff_id: string | null;
  /** Explicit per-user POS grant. Role alone never grants POS access — see
   *  src/lib/pos/permissions.ts. Owner ignores this and always has access. */
  pos_access: boolean;
  /** pos_departments.id[] this user may work in. null = unrestricted, which
   *  is only ever correct for an owner. */
  pos_department_scope: string[] | null;
}

const CurrentUserContext = createContext<CurrentUser | null>(null);

export function CurrentUserProvider({ value, children }: { value: CurrentUser | null; children: React.ReactNode }) {
  return <CurrentUserContext.Provider value={value}>{children}</CurrentUserContext.Provider>;
}

export function useCurrentUser(): CurrentUser | null {
  return useContext(CurrentUserContext);
}
