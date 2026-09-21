import type { IncomingMessage } from 'node:http';

import { describe, expect, it } from 'vitest';

import { authenticatePersistenceHeaders, authenticatePersistenceRequest } from '@/lib/persistence/server-auth';

function nodeRequest(headers: IncomingMessage['headers']): IncomingMessage {
  return { headers } as IncomingMessage;
}

describe('embedded persistence runtime/asset authentication', () => {
  it('accepts a request middleware verified as admin, with its learner partition', async () => {
    await expect(
      authenticatePersistenceRequest(
        nodeRequest({ 'x-access-role': 'admin', 'x-learner-key': 'anon:learner-1' }),
      ),
    ).resolves.toEqual({ key: 'shared', learnerKey: 'anon:learner-1' });
  });

  it('accepts a request middleware verified as learner', async () => {
    await expect(
      authenticatePersistenceRequest(
        nodeRequest({ 'x-access-role': 'learner', 'x-learner-key': 'anon:learner-2' }),
      ),
    ).resolves.toEqual({ key: 'shared', learnerKey: 'anon:learner-2' });
  });

  it('shares one asset principal across learner keys, like the global documents', async () => {
    const first = await authenticatePersistenceRequest(
      nodeRequest({ 'x-access-role': 'admin', 'x-learner-key': 'anon:a' }),
    );
    const second = await authenticatePersistenceRequest(
      nodeRequest({ 'x-access-role': 'admin', 'x-learner-key': 'anon:b' }),
    );
    expect(first?.key).toBe('shared');
    expect(second?.key).toBe('shared');
    expect(first?.learnerKey).not.toBe(second?.learnerKey);
  });

  it('issues the shared asset principal even without a learner key', async () => {
    await expect(
      authenticatePersistenceRequest(nodeRequest({ 'x-access-role': 'admin' })),
    ).resolves.toEqual({ key: 'shared' });
  });

  it('rejects a request with no role header at all', async () => {
    await expect(authenticatePersistenceRequest(nodeRequest({}))).resolves.toBeUndefined();
  });

  it('rejects a role header that is not admin or learner -- a client cannot forge its way in', async () => {
    await expect(
      authenticatePersistenceRequest(nodeRequest({ 'x-access-role': 'superuser' })),
    ).resolves.toBeUndefined();
  });

  it('mirrors the same behavior from the Headers-based entry point used by app routes', () => {
    const headers = new Headers({ 'x-access-role': 'learner', 'x-learner-key': 'anon:c' });
    expect(authenticatePersistenceHeaders(headers)).toEqual({ key: 'shared', learnerKey: 'anon:c' });

    expect(authenticatePersistenceHeaders(new Headers())).toBeUndefined();
  });
});
