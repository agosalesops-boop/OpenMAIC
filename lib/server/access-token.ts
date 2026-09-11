import { createHmac, timingSafeEqual } from 'crypto';

/** Which access code a visitor logged in with. */
export type AccessRole = 'admin' | 'learner';

/**
 * Create an HMAC-signed token: `role.timestamp.signature`.
 *
 * The role travels inside the signed payload (not just alongside it), so a
 * token can't be "upgraded" from learner to admin by editing the cookie —
 * the signature only verifies against the access code for the role it
 * actually claims.
 */
export function createAccessToken(role: AccessRole, accessCode: string): string {
  const timestamp = Date.now().toString();
  const payload = `${role}.${timestamp}`;
  const signature = createHmac('sha256', accessCode).update(payload).digest('hex');
  return `${role}.${timestamp}.${signature}`;
}

/**
 * Verify an HMAC-signed token against the access code(s) configured for
 * each role. Returns the verified role, or null if the token is missing,
 * malformed, or its signature doesn't match the code for its claimed role
 * (including when that role's code isn't configured at all).
 */
export function verifyAccessToken(
  token: string,
  codesByRole: Partial<Record<AccessRole, string>>,
): AccessRole | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [role, timestamp, signature] = parts;
  if (role !== 'admin' && role !== 'learner') return null;

  const accessCode = codesByRole[role];
  if (!accessCode) return null;

  const payload = `${role}.${timestamp}`;
  const expected = createHmac('sha256', accessCode).update(payload).digest('hex');

  const sigBuf = Buffer.from(signature, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length) return null;

  return timingSafeEqual(sigBuf, expBuf) ? role : null;
}
