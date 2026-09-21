import { cookies } from 'next/headers';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createAccessToken, type AccessRole } from '@/lib/server/access-token';
import { verifyLoginCode } from '@/lib/persistence/accounts';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';

export async function POST(request: Request) {
  const accessCode = process.env.ACCESS_CODE;
  const tokenSecret = process.env.ACCOUNT_TOKEN_SECRET;
  const connectionString = process.env.DATABASE_URL;
  // Mirrors middleware.ts's authEnabled: either var configured means auth is
  // required, not just tokenSecret alone (see status/route.ts for the same fix).
  const authConfigured = !!accessCode || !!tokenSecret;

  if (!authConfigured) {
    // Neither configured -- match middleware's wide-open dev mode.
    return apiSuccess({ valid: true, role: 'admin' as AccessRole });
  }

  if (!tokenSecret || !connectionString) {
    // ACCESS_CODE is set but the new secret (or DATABASE_URL) isn't --
    // middleware fails closed in this state, so a login here could never
    // actually work (no way to sign a verifiable cookie). Fail clearly
    // instead of pretending success with no cookie behind it.
    return apiError(
      'INTERNAL_ERROR',
      503,
      'Sign-in is not fully configured yet',
      'ACCOUNT_TOKEN_SECRET (and DATABASE_URL) must be set alongside ACCESS_CODE',
    );
  }

  let body: { code?: string };
  try {
    body = await request.json();
  } catch {
    return apiError('INVALID_REQUEST', 400, 'Invalid JSON body');
  }

  if (!body.code) {
    return apiError('INVALID_REQUEST', 401, 'Invalid access code');
  }

  const { pool } = await getServerPersistenceProvider(connectionString);
  const result = await verifyLoginCode(pool, body.code);
  if (!result) {
    return apiError('INVALID_REQUEST', 401, 'Invalid access code');
  }

  const token = createAccessToken(result.account.id, result.account.role, tokenSecret);
  const cookieStore = await cookies();
  cookieStore.set('openmaic_access', token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    secure: process.env.NODE_ENV === 'production',
  });

  return apiSuccess({
    valid: true,
    role: result.account.role,
    name: result.account.name,
    ...(result.bootstrapCode ? { bootstrapCode: result.bootstrapCode } : {}),
  });
}
