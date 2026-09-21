import { createHmac, timingSafeEqual } from 'crypto';

/** Which account role a visitor logged in as. */
export type AccessRole = 'admin' | 'learner';

export interface AccessTokenPayload {
  accountId: string;
  role: AccessRole;
  issuedAt: number;
}

/**
 * Create an HMAC-signed session token: `accountId.role.timestamp.signature`.
 *
 * Unlike the old scheme (one shared code per role, used as its own signing
 * key), the signing key here is a server-only secret (`ACCOUNT_TOKEN_SECRET`)
 * that never travels to the client, and the payload carries a specific
 * account's identity. A token can't be "upgraded" from learner to admin, or
 * from one account to another, by editing the cookie -- the signature only
 * verifies against the one secret the server holds, over the exact
 * accountId+role it claims.
 */
export function createAccessToken(accountId: string, role: AccessRole, secret: string): string {
  const timestamp = Date.now().toString();
  const payload = `${accountId}.${role}.${timestamp}`;
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  return `${accountId}.${role}.${timestamp}.${signature}`;
}

/**
 * Verify an HMAC-signed token against the server secret. Returns the claimed
 * accountId/role/issuedAt, or null if the token is missing, malformed, or its
 * signature doesn't match. This only proves the token was issued by this
 * server for this accountId+role -- callers that need to honor revocation
 * (an account deleted or revoked after the token was issued) must separately
 * re-check the account's current state, which this function has no way to
 * know about.
 */
export function verifyAccessToken(token: string, secret: string): AccessTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [accountId, role, timestamp, signature] = parts;
  if (role !== 'admin' && role !== 'learner') return null;
  if (!accountId || !/^\d+$/.test(timestamp)) return null;

  const payload = `${accountId}.${role}.${timestamp}`;
  const expected = createHmac('sha256', secret).update(payload).digest('hex');

  const sigBuf = Buffer.from(signature, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length === 0 || sigBuf.length !== expBuf.length) return null;

  return timingSafeEqual(sigBuf, expBuf) ? { accountId, role, issuedAt: Number(timestamp) } : null;
}
