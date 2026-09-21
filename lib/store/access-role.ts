'use client';

import { create } from 'zustand';
import type { AccessRole } from '@/lib/server/access-token';

export type { AccessRole };

interface AccessRoleState {
  /**
   * Which role the current visitor logged in as. `null` until the initial
   * `/api/access-code/status` check resolves (or when access-code gating is
   * disabled entirely, in which case it stays `null` forever and every
   * learner-only gate below treats that as "not a learner").
   *
   * Deliberately NOT persisted to localStorage: this must always reflect the
   * live, server-verified cookie, never a stale cached value from a previous
   * login (e.g. after switching accounts, or after being revoked).
   */
  role: AccessRole | null;
  /** Display name of the logged-in account, when known. */
  name: string | null;
  setSession: (session: { role: AccessRole | null; name?: string | null }) => void;
}

export const useAccessRoleStore = create<AccessRoleState>((set) => ({
  role: null,
  name: null,
  setSession: ({ role, name }) => set({ role, name: name ?? null }),
}));

/**
 * True once the server has confirmed the current visitor logged in with the
 * learner role. This is a UI-convenience gate only -- it hides admin-only
 * affordances (create course, edit, Pro Workbench, Settings) so a learner
 * isn't shown controls they can't meaningfully use. It is NOT the security
 * boundary: the underlying API routes enforce this independently via
 * middleware-verified session headers.
 */
export function useIsLearner(): boolean {
  return useAccessRoleStore((s) => s.role === 'learner');
}
