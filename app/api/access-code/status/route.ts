import { cookies } from 'next/headers';
import { apiSuccess } from '@/lib/server/api-response';
import { getAccountById } from '@/lib/persistence/accounts';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { verifyAccessToken, type AccessRole } from '@/lib/server/access-token';

export async function GET() {
  const tokenSecret = process.env.ACCOUNT_TOKEN_SECRET;
  const connectionString = process.env.DATABASE_URL;
  const enabled = !!tokenSecret;

  if (!enabled) {
    return apiSuccess({
      enabled: false,
      authenticated: true,
      role: 'admin' as AccessRole,
      name: null,
    });
  }

  const cookieStore = await cookies();
  const token = cookieStore.get('openmaic_access')?.value;
  if (!token || !connectionString) {
    return apiSuccess({ enabled: true, authenticated: false, role: null, name: null });
  }

  const payload = verifyAccessToken(token, tokenSecret);
  if (!payload) {
    return apiSuccess({ enabled: true, authenticated: false, role: null, name: null });
  }

  const { pool } = await getServerPersistenceProvider(connectionString);
  const account = await getAccountById(pool, payload.accountId);
  if (!account || account.revokedAt || account.role !== payload.role) {
    return apiSuccess({ enabled: true, authenticated: false, role: null, name: null });
  }

  return apiSuccess({ enabled: true, authenticated: true, role: account.role, name: account.name });
}
