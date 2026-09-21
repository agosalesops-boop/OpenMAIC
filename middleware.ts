import { NextRequest, NextResponse } from 'next/server';

import { isAgentRuntimeConfigured, isProWorkbenchEnabled } from '@/lib/config/feature-flags';
import { getAccountById } from '@/lib/persistence/accounts';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { verifyAccessToken } from '@/lib/server/access-token';

// Node.js Middleware (stable since Next.js 15.5) rather than the Edge
// runtime: revocation has to be checked against Postgres on every request
// (see below), and the `pg` driver needs real TCP sockets that the Edge
// runtime does not provide.
export const runtime = 'nodejs';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Return an actual server-side 404 when either half of the workbench is off.
  const workbenchEnabled = isProWorkbenchEnabled() && isAgentRuntimeConfigured();
  if (!workbenchEnabled && (pathname === '/workbench' || pathname.startsWith('/workbench/'))) {
    return new NextResponse('Not found', { status: 404 });
  }

  const accessCode = process.env.ACCESS_CODE;
  const tokenSecret = process.env.ACCOUNT_TOKEN_SECRET;
  const authEnabled = !!accessCode || !!tokenSecret;

  if (!authEnabled) {
    // Local/dev convenience, matching the previous behavior: with neither
    // env var configured, every visitor is treated as an unauthenticated
    // admin so persistence routes downstream still see a role to trust.
    const headers = new Headers(request.headers);
    headers.set('x-access-role', 'admin');
    headers.set('x-account-id', 'local-dev');
    return NextResponse.next({ request: { headers } });
  }

  // Whitelist: access-code endpoints (login/status/logout), health check.
  if (pathname.startsWith('/api/access-code/') || pathname === '/api/health') {
    return NextResponse.next();
  }

  let verifiedAccountId: string | null = null;
  let verifiedRole: 'admin' | 'learner' | null = null;

  const cookie = request.cookies.get('openmaic_access');
  if (cookie?.value && tokenSecret) {
    const payload = verifyAccessToken(cookie.value, tokenSecret);
    if (payload) {
      try {
        const connectionString = process.env.DATABASE_URL;
        if (connectionString) {
          const { pool } = await getServerPersistenceProvider(connectionString);
          const account = await getAccountById(pool, payload.accountId);
          if (account && !account.revokedAt && account.role === payload.role) {
            verifiedAccountId = account.id;
            verifiedRole = account.role;
          }
        }
      } catch (error) {
        console.error('Session verification failed', error);
      }
    }
  }
  // If tokenSecret is missing (ACCESS_CODE configured without the new
  // secret), or the account lookup above didn't produce a role, this falls
  // through to the unauthenticated branches below -- fails closed rather
  // than silently granting access.

  if (verifiedRole && verifiedAccountId) {
    // Forward the verified identity downstream via request headers so server
    // components / route handlers can read it without re-verifying the
    // cookie themselves. Untrusted client input can never set these headers
    // directly -- Next strips/overwrites request headers set here before
    // the request reaches app code, and this is the only place that sets them.
    const headers = new Headers(request.headers);
    headers.set('x-access-role', verifiedRole);
    headers.set('x-account-id', verifiedAccountId);
    return NextResponse.next({ request: { headers } });
  }

  // API requests without a valid session → 401
  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { success: false, errorCode: 'INVALID_REQUEST', error: 'Access code required' },
      { status: 401 },
    );
  }

  // Page requests → let through, frontend shows the login modal.
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logos/).*)'],
};
