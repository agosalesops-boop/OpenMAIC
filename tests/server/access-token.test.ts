import { describe, expect, test, vi } from 'vitest';

import { createAccessToken, verifyAccessToken } from '@/lib/server/access-token';

describe('access token signing', () => {
  test('verifies a token signed with the same server secret', () => {
    vi.setSystemTime(new Date('2026-06-25T00:00:00Z'));

    const token = createAccessToken('acct_123', 'admin', 'server-secret');
    const payload = verifyAccessToken(token, 'server-secret');

    expect(payload).toEqual({ accountId: 'acct_123', role: 'admin', issuedAt: Date.now() });

    vi.useRealTimers();
  });

  test('rejects a token verified against the wrong secret', () => {
    const token = createAccessToken('acct_123', 'learner', 'server-secret');
    expect(verifyAccessToken(token, 'other-secret')).toBeNull();
  });

  test('rejects a malformed token', () => {
    expect(verifyAccessToken('not-a-token', 'server-secret')).toBeNull();
    expect(verifyAccessToken('acct_123.admin.123', 'server-secret')).toBeNull();
  });

  test('rejects a token whose accountId was tampered with after signing', () => {
    const token = createAccessToken('acct_123', 'admin', 'server-secret');
    const [, role, timestamp, signature] = token.split('.');
    const tampered = ['acct_999', role, timestamp, signature].join('.');
    expect(verifyAccessToken(tampered, 'server-secret')).toBeNull();
  });

  test('rejects a token whose role was tampered with after signing', () => {
    const token = createAccessToken('acct_123', 'learner', 'server-secret');
    const [accountId, , timestamp, signature] = token.split('.');
    const tampered = [accountId, 'admin', timestamp, signature].join('.');
    expect(verifyAccessToken(tampered, 'server-secret')).toBeNull();
  });
});
