import { apiError, apiSuccess } from '@/lib/server/api-response';
import { requireAdminRole } from '@/lib/server/require-admin';
import {
  BATCH_LABEL_MAX_LENGTH,
  revokeAccount,
  serializeAccount,
  updateAccountBatchLabel,
} from '@/lib/persistence/accounts';
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

/**
 * PATCH /api/accounts/[id] { batchLabel: string | null } -- set, change or
 * clear (null / empty string) an account's batch label, e.g. to fix a typo
 * or move someone into the right cohort. Admin-only.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = requireAdminRole(request);
  if (!('accountId' in guard)) return guard;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('INVALID_REQUEST', 400, 'Invalid JSON body');
  }
  if (typeof body !== 'object' || body === null || !('batchLabel' in body)) {
    return apiError('INVALID_REQUEST', 400, 'batchLabel is required (use null to clear it)');
  }
  const batchLabel = (body as { batchLabel: unknown }).batchLabel;
  if (
    batchLabel !== null &&
    (typeof batchLabel !== 'string' || batchLabel.trim().length > BATCH_LABEL_MAX_LENGTH)
  ) {
    return apiError(
      'INVALID_REQUEST',
      400,
      `batchLabel must be null or a string of at most ${BATCH_LABEL_MAX_LENGTH} characters`,
    );
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return apiError('INTERNAL_ERROR', 503, 'Server persistence not configured');
  }

  const { id } = await params;
  const { pool } = await getServerPersistenceProvider(connectionString);
  const account = await updateAccountBatchLabel(pool, id, batchLabel);
  if (!account) return apiError('NOT_FOUND', 404, 'Account not found');
  return apiSuccess({ account: serializeAccount(account) });
}
