import { apiError, apiSuccess } from '@/lib/server/api-response';
import { requireAdminRole } from '@/lib/server/require-admin';
import {
  BATCH_LABEL_MAX_LENGTH,
  createAccount,
  listAccounts,
  serializeAccount,
  type Account,
} from '@/lib/persistence/accounts';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';

export async function GET(request: Request) {
  const guard = requireAdminRole(request);
  if (!('accountId' in guard)) return guard;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return apiError('INTERNAL_ERROR', 503, 'Server persistence not configured');
  }

  const { pool } = await getServerPersistenceProvider(connectionString);
  const accounts = await listAccounts(pool);
  return apiSuccess({ accounts: accounts.map(serializeAccount) });
}

export async function POST(request: Request) {
  const guard = requireAdminRole(request);
  if (!('accountId' in guard)) return guard;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return apiError('INTERNAL_ERROR', 503, 'Server persistence not configured');
  }

  let body: { name?: string; role?: string; batchLabel?: unknown };
  try {
    body = await request.json();
  } catch {
    return apiError('INVALID_REQUEST', 400, 'Invalid JSON body');
  }

  const name = body.name?.trim();
  const role: Account['role'] | undefined =
    body.role === 'admin' || body.role === 'learner' ? body.role : undefined;
  if (!name || !role) {
    return apiError('INVALID_REQUEST', 400, 'name and role are required');
  }

  if (body.batchLabel !== undefined && body.batchLabel !== null) {
    if (
      typeof body.batchLabel !== 'string' ||
      body.batchLabel.trim().length > BATCH_LABEL_MAX_LENGTH
    ) {
      return apiError(
        'INVALID_REQUEST',
        400,
        `batchLabel must be a string of at most ${BATCH_LABEL_MAX_LENGTH} characters`,
      );
    }
  }

  const { pool } = await getServerPersistenceProvider(connectionString);
  const { account, code } = await createAccount(
    pool,
    name,
    role,
    (body.batchLabel as string | null | undefined) ?? null,
  );
  return apiSuccess({ account: serializeAccount(account), code });
}
