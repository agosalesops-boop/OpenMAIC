/**
 * GET  /api/stages/[id]/complete — has the calling account completed this course?
 * POST /api/stages/[id]/complete — mark it complete for the calling account (self-report).
 *
 * Any authenticated account (admin or learner) may mark its own completion --
 * this is not admin-gated, unlike the mutation routes in Batch 2's RBAC pass.
 * Identity comes from the verified `x-account-id` header middleware sets; a
 * request without one is rejected the same way requireAdminRole rejects a
 * non-admin, just without the role check.
 */
import type { NextRequest } from 'next/server';

import { apiError, apiSuccess } from '@/lib/server/api-response';
import { getCompletion, recordCompletion } from '@/lib/persistence/completions';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';

type Params = { params: Promise<{ id: string }> };

function requireAccountId(req: NextRequest): string | null {
  return req.headers.get('x-account-id');
}

export async function GET(req: NextRequest, { params }: Params) {
  const accountId = requireAccountId(req);
  if (!accountId) return apiError('FORBIDDEN', 403, 'Sign-in required');

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return apiError('INTERNAL_ERROR', 503, 'Server persistence not configured');
  }

  const { id } = await params;
  const { pool } = await getServerPersistenceProvider(connectionString);
  const completedAt = await getCompletion(pool, accountId, id);
  return apiSuccess({ completed: completedAt !== null, completedAt: completedAt?.toISOString() ?? null });
}

export async function POST(req: NextRequest, { params }: Params) {
  const accountId = requireAccountId(req);
  if (!accountId) return apiError('FORBIDDEN', 403, 'Sign-in required');

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return apiError('INTERNAL_ERROR', 503, 'Server persistence not configured');
  }

  const { id } = await params;
  const { pool } = await getServerPersistenceProvider(connectionString);
  await recordCompletion(pool, accountId, id);
  const completedAt = await getCompletion(pool, accountId, id);
  return apiSuccess({ completed: true, completedAt: completedAt?.toISOString() ?? null });
}
