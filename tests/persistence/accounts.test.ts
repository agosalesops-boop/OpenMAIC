import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  countAccounts,
  createAccount,
  ensureAccountsSchema,
  getAccountById,
  listAccounts,
  revokeAccount,
  verifyAccountCode,
  verifyLoginCode,
} from '@/lib/persistence/accounts';

class PGlitePool {
  constructor(readonly db: PGlite) {}

  query(text: string, params?: unknown[]) {
    return this.db.query(text, params);
  }

  async end() {
    await this.db.close();
  }
}

describe('accounts', () => {
  let db: PGlite;
  let pool: PGlitePool;

  beforeEach(async () => {
    vi.unstubAllEnvs();
    db = new PGlite();
    await db.waitReady;
    pool = new PGlitePool(db);
    await ensureAccountsSchema(pool as never);
  });

  afterEach(async () => {
    await pool.end();
    vi.unstubAllEnvs();
  });

  it('creates an account and returns a code that verifies back to it', async () => {
    const { account, code } = await createAccount(pool as never, '  Jane Tan  ', 'learner');

    expect(account.name).toBe('Jane Tan'); // trimmed
    expect(account.role).toBe('learner');
    expect(account.revokedAt).toBeNull();
    expect(code).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/);

    const verified = await verifyAccountCode(pool as never, code);
    expect(verified).toEqual(account);
  });

  it('rejects an empty or whitespace-only name', async () => {
    await expect(createAccount(pool as never, '   ', 'admin')).rejects.toThrow(
      'Account name is required',
    );
  });

  it('is case- and formatting-insensitive when verifying a code', async () => {
    const { code } = await createAccount(pool as never, 'Formatting Test', 'learner');
    const messyInput = ` ${code.toLowerCase().replace('-', ' ')} `;

    expect(await verifyAccountCode(pool as never, messyInput)).not.toBeNull();
  });

  it('never lets the raw code round-trip through storage -- only its hash is kept', async () => {
    const { code } = await createAccount(pool as never, 'Opacity Test', 'admin');
    const raw = await db.query<{ code_hash: string }>('SELECT code_hash FROM accounts');
    expect(raw.rows[0]?.code_hash).not.toContain(code.replace('-', ''));
    expect(raw.rows[0]?.code_hash).toMatch(/^[a-f0-9]{64}$/); // sha256 hex
  });

  it('rejects an unknown code', async () => {
    await createAccount(pool as never, 'Someone', 'learner');
    expect(await verifyAccountCode(pool as never, 'NOTREAL-CODE1')).toBeNull();
  });

  it('lists newest accounts first', async () => {
    const first = await createAccount(pool as never, 'First', 'learner');
    const second = await createAccount(pool as never, 'Second', 'admin');

    const all = await listAccounts(pool as never);
    expect(all.map((a) => a.id)).toEqual([second.account.id, first.account.id]);
  });

  it('revokes an account so its code stops working but its id is still readable', async () => {
    const { account, code } = await createAccount(pool as never, 'Revoke Me', 'learner');

    const revoked = await revokeAccount(pool as never, account.id);
    expect(revoked).toBe(true);

    expect(await verifyAccountCode(pool as never, code)).toBeNull();
    const stillReadable = await getAccountById(pool as never, account.id);
    expect(stillReadable?.revokedAt).not.toBeNull();
  });

  it('revoking twice is a harmless no-op that still reports success', async () => {
    const { account } = await createAccount(pool as never, 'Double Revoke', 'learner');
    expect(await revokeAccount(pool as never, account.id)).toBe(true);
    expect(await revokeAccount(pool as never, account.id)).toBe(true);
  });

  it('revoking an id that never existed reports failure', async () => {
    expect(await revokeAccount(pool as never, 'acct_does_not_exist')).toBe(false);
  });

  describe('verifyLoginCode / bootstrap', () => {
    it('logs in against a real account without touching the bootstrap path', async () => {
      vi.stubEnv('ACCESS_CODE', 'shared-bootstrap-code');
      const { account, code } = await createAccount(pool as never, 'Existing Admin', 'admin');

      const result = await verifyLoginCode(pool as never, code);
      expect(result).toEqual({ account });
      expect(await countAccounts(pool as never)).toBe(1); // bootstrap did not also fire
    });

    it('bootstraps the first admin account from ACCESS_CODE when no accounts exist', async () => {
      vi.stubEnv('ACCESS_CODE', 'shared-bootstrap-code');

      const result = await verifyLoginCode(pool as never, 'shared-bootstrap-code');

      expect(result?.account.role).toBe('admin');
      expect(result?.bootstrapCode).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/);
      expect(result?.bootstrapCode).not.toBe('shared-bootstrap-code');
      expect(await countAccounts(pool as never)).toBe(1);
    });

    it('never matches ACCESS_CODE again once an account exists', async () => {
      vi.stubEnv('ACCESS_CODE', 'shared-bootstrap-code');
      await createAccount(pool as never, 'Already Here', 'learner');

      const result = await verifyLoginCode(pool as never, 'shared-bootstrap-code');
      expect(result).toBeNull();
    });

    it('rejects an unknown code when no ACCESS_CODE is configured', async () => {
      vi.stubEnv('ACCESS_CODE', '');
      expect(await verifyLoginCode(pool as never, 'anything')).toBeNull();
    });

    it('rejects a code that does not match ACCESS_CODE when bootstrapping is available', async () => {
      vi.stubEnv('ACCESS_CODE', 'shared-bootstrap-code');
      expect(await verifyLoginCode(pool as never, 'wrong-code')).toBeNull();
      expect(await countAccounts(pool as never)).toBe(0);
    });
  });
});
