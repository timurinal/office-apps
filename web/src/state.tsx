/**
 * App state, as the editors ask for it: who is signed in, and whether the app is ready.
 *
 * The desktop app has no accounts and no server, so the answer is fixed: ready, and
 * nobody. `me: null` is what the editors already handle for someone without an
 * account (their own caret, no presence, no suggesting), and the context has a
 * default so a component works without the provider too.
 */

import { createContext, useContext } from 'react';
import type React from 'react';
import type { Branding } from '@shared/branding';
import type { MeResponse } from '@shared/api';

export type AppStatus = 'loading' | 'signedOut' | 'secondFactor' | 'notReady' | 'unreachable' | 'ready';

export interface NotReady {
  message: string;
  missingTables?: string[];
  hint?: string;
}

interface AppValue {
  status: AppStatus;
  me: MeResponse | null;
  notReady: NotReady | null;
  refresh: () => Promise<void>;
}

const LOCAL: AppValue = { status: 'ready', me: null, notReady: null, refresh: async () => undefined };

const Ctx = createContext<AppValue>(LOCAL);

export function useApp(): AppValue {
  return useContext(Ctx);
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  return <Ctx.Provider value={LOCAL}>{children}</Ctx.Provider>;
}

/** An organisation's branding. There are no organisations here. */
export function useBranding(): Branding | null {
  return null;
}
