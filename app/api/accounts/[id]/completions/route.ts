/**
 * GET /api/accounts/[id]/completions — the courses this account has
 * completed, for admin visibility. Admin-only, same guard as the rest of
 * the accounts family.
 */
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { requireAdminRole } from '@/lib/server/require-admin';
import { getAccountById } from '@/lib/persistence/accounts';
import { listCompletionsForAccount } from '@/lib/persistence/completions';
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

  const completions = await listCompletionsForAccount(pool, id);
  return apiSuccess({
    completions: completions.map((c) => ({ stageId: c.stageId, completedAt: c.completedAt.toISOString() })),
  });
}
