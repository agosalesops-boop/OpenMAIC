import { NextResponse } from 'next/server';

import { apiError, type ApiErrorBody } from '@/lib/server/api-response';

/**
 * Require that the request already carries a verified admin session.
 *
 * Reads `x-access-role` / `x-account-id`, which only `middleware.ts` sets --
 * every matched request passes through it first, and it rejects anything
 * without a validly signed, non-revoked account cookie before this code ever
 * runs. A client cannot forge these headers directly (Next strips/overwrites
 * request headers set in middleware before the request reaches app code).
 */
export function requireAdminRole(
  request: Request,
): { accountId: string } | NextResponse<ApiErrorBody> {
  const role = request.headers.get('x-access-role');
  const accountId = request.headers.get('x-account-id');
  if (role !== 'admin' || !accountId) {
    return apiError('FORBIDDEN', 403, 'Admin access required');
  }
  return { accountId };
}
