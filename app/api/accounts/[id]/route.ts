import { apiError, apiSuccess } from '@/lib/server/api-response';
import { requireAdminRole } from '@/lib/server/require-admin';
import { revokeAccount } from '@/lib/persistence/accounts';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = requireAdminRole(request);
  if (!('accountId' in guard)) return guard;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return apiError('INTERNAL_ERROR', 503, 'Server persistence not configured');
  }

  const { id } = await params;
  const { pool } = await getServerPersistenceProvider(connectionString);
  const ok = await revokeAccount(pool, id);
  if (!ok) return apiError('NOT_FOUND', 404, 'Account not found');
  return apiSuccess({ revoked: true });
}
