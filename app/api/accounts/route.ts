import { apiError, apiSuccess } from '@/lib/server/api-response';
import { requireAdminRole } from '@/lib/server/require-admin';
import { createAccount, listAccounts, type AccountRole } from '@/lib/persistence/accounts';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';

function serialize(account: {
  id: string;
  name: string;
  role: AccountRole;
  createdAt: Date;
  revokedAt: Date | null;
}) {
  return {
    id: account.id,
    name: account.name,
    role: account.role,
    createdAt: account.createdAt.toISOString(),
    revokedAt: account.revokedAt ? account.revokedAt.toISOString() : null,
  };
}

export async function GET(request: Request) {
  const guard = requireAdminRole(request);
  if (!('accountId' in guard)) return guard;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return apiError('INTERNAL_ERROR', 503, 'Server persistence not configured');
  }

  const { pool } = await getServerPersistenceProvider(connectionString);
  const accounts = await listAccounts(pool);
  return apiSuccess({ accounts: accounts.map(serialize) });
}

export async function POST(request: Request) {
  const guard = requireAdminRole(request);
  if (!('accountId' in guard)) return guard;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return apiError('INTERNAL_ERROR', 503, 'Server persistence not configured');
  }

  let body: { name?: string; role?: string };
  try {
    body = await request.json();
  } catch {
    return apiError('INVALID_REQUEST', 400, 'Invalid JSON body');
  }

  const name = body.name?.trim();
  const role: AccountRole | undefined =
    body.role === 'admin' || body.role === 'learner' ? body.role : undefined;
  if (!name || !role) {
    return apiError('INVALID_REQUEST', 400, 'name and role are required');
  }

  const { pool } = await getServerPersistenceProvider(connectionString);
  const { account, code } = await createAccount(pool, name, role);
  return apiSuccess({ account: serialize(account), code });
}
