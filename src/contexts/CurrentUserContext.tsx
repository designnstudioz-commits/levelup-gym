"use client";

import { createContext, useContext } from "react";
import type { SystemRole } from "@/types/database";

export interface CurrentUser {
  id: string;
  full_name: string | null;
  role: SystemRole | null;
}

const CurrentUserContext = createContext<CurrentUser | null>(null);

export function CurrentUserProvider({ value, children }: { value: CurrentUser | null; children: React.ReactNode }) {
  return <CurrentUserContext.Provider value={value}>{children}</CurrentUserContext.Provider>;
}

export function useCurrentUser(): CurrentUser | null {
  return useContext(CurrentUserContext);
}
