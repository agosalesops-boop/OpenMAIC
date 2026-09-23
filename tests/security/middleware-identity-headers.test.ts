/**
 * Page requests without a valid session are let through (the frontend shows
 * the login modal), so middleware must strip any client-supplied identity
 * headers on that path -- otherwise a request could arrive at a server
 * component such as /admin carrying a forged `x-access-role: admin`.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { middleware } from '@/middleware';

function overriddenRequestHeaders(response: Response): string[] {
  return (response.headers.get('x-middleware-override-headers') ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
}

describe('middleware identity headers', () => {
  beforeEach(() => {
    vi.stubEnv('ACCESS_CODE', 'bootstrap-code');
    vi.stubEnv('ACCOUNT_TOKEN_SECRET', 'test-secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('strips a forged x-access-role from an unauthenticated page request', async () => {
    const request = new NextRequest('http://localhost/admin', {
      headers: { 'x-access-role': 'admin', 'x-account-id': 'acct_forged' },
    });

    const response = await middleware(request);

    expect(response.status).toBe(200);
    const forwarded = overriddenRequestHeaders(response);
    expect(forwarded).not.toContain('x-access-role');
    expect(forwarded).not.toContain('x-account-id');
    expect(response.headers.get('x-middleware-request-x-access-role')).toBeNull();
  });

  it('still rejects an unauthenticated API request outright', async () => {
    const request = new NextRequest('http://localhost/api/admin/dashboard/summary', {
      headers: { 'x-access-role': 'admin', 'x-account-id': 'acct_forged' },
    });

    const response = await middleware(request);
    expect(response.status).toBe(401);
  });
});
