/**
 * GET  /api/accounts/[id]/assignments — the course ids assigned to this
 *      account (empty array means unrestricted -- see course-assignments.ts).
 * PUT  /api/accounts/[id]/assignments { stageIds: string[] } — replace the
 *      account's full assignment set.
 *
 * Admin-only, same guard as every other accounts route.
 */
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { requireAdminRole } from '@/lib/server/require-admin';
import { getAccountById } from '@/lib/persistence/accounts';
import { listAssignedStageIds, setAssignedStageIds } from '@/lib/persistence/course-assignments';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const guard = requireAdminRole(request);
  if (!('accountId' in guard)) return guard;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return apiError('INTERNAL_ERROR', 503, 'Server persistence not configured');
  }

  const { id } = await params;
  const { pool } = await getServerPersistenceProvider(connectionString);
  const account = await getAccountById(pool, id);
  if (!account) return apiError('NOT_FOUND', 404, 'Account not found');

  const stageIds = await listAssignedStageIds(pool, id);
  return apiSuccess({ stageIds });
}

export async function PUT(request: Request, { params }: Params) {
  const guard = requireAdminRole(request);
  if (!('accountId' in guard)) return guard;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('INVALID_REQUEST', 400, 'invalid JSON body');
  }
  const stageIds = (body as { stageIds?: unknown })?.stageIds;
  if (!Array.isArray(stageIds) || stageIds.some((id) => typeof id !== 'string')) {
    return apiError('INVALID_REQUEST', 400, 'stageIds must be an array of strings');
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return apiError('INTERNAL_ERROR', 503, 'Server persistence not configured');
  }

  const { id } = await params;
  const { pool } = await getServerPersistenceProvider(connectionString);
  const account = await getAccountById(pool, id);
  if (!account) return apiError('NOT_FOUND', 404, 'Account not found');

  await setAssignedStageIds(pool, id, stageIds as string[]);
  return apiSuccess({ stageIds: Array.from(new Set(stageIds as string[])) });
}
