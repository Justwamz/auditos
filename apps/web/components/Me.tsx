'use client';
import { createContext, useContext, type ReactNode } from 'react';

export interface MeInfo { role: string; isAdmin: boolean }

const MeContext = createContext<MeInfo | null>(null);

/** Gives pages the signed-in person's role without asking the server again. */
export function MeProvider({ role, isAdmin, children }: MeInfo & { children: ReactNode }) {
  return <MeContext.Provider value={{ role, isAdmin }}>{children}</MeContext.Provider>;
}

export function useMe(): MeInfo {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe needs the MeProvider from the app layout');
  return me;
}
