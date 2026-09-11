'use client';

import { create } from 'zustand';
import type { AccessRole } from '@/lib/server/access-token';

export type { AccessRole };

interface AccessRoleState {
  /**
   * Which access code the current visitor logged in with. `null` until the
   * initial `/api/access-code/status` check resolves (or when access-code
   * gating is disabled entirely, in which case it stays `null` forever and
   * every learner-only gate below treats that as "not a learner").
   *
   * Deliberately NOT persisted to localStorage: this must always reflect the
   * live, server-verified cookie, never a stale cached value from a previous
   * login (e.g. after switching from the learner code to the admin code).
   */
  role: AccessRole | null;
  setRole: (role: AccessRole | null) => void;
}

export const useAccessRoleStore = create<AccessRoleState>((set) => ({
  role: null,
  setRole: (role) => set({ role }),
}));

/**
 * True once the server has confirmed the current visitor logged in with the
 * learner code. This is a UI-convenience gate only — it hides admin-only
 * affordances (create course, edit, Pro Workbench, Settings) so a learner
 * isn't shown controls they can't meaningfully use. It is NOT the security
 * boundary: the underlying API routes must enforce this independently
 * (tracked separately), since any client-side check can be bypassed by
 * calling the API directly.
 */
export function useIsLearner(): boolean {
  return useAccessRoleStore((s) => s.role === 'learner');
}
