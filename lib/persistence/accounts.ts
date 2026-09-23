/**
 * Individual admin/learner accounts, replacing the two shared static access
 * codes (`ACCESS_CODE` / `LEARNER_ACCESS_CODE`) with real per-person logins.
 *
 * Only a SHA-256 hash of each account's access code is ever stored -- the
 * raw code is generated here, returned exactly once to the caller (at
 * creation, or at bootstrap), and can never be recovered afterwards. Losing
 * it means revoking the account and creating a new one.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { customAlphabet } from 'nanoid';

import type { Queryable } from '@openmaic/storage/document/pg';

import { normalizeBatchLabel } from '@/lib/accounts/batch-label';

export { BATCH_LABEL_MAX_LENGTH, normalizeBatchLabel } from '@/lib/accounts/batch-label';

export type AccountRole = 'admin' | 'learner';

export interface Account {
  id: string;
  name: string;
  role: AccountRole;
  createdAt: Date;
  revokedAt: Date | null;
  /**
   * Free-text cohort ("batch") label, e.g. "Sept 2026 - Sales A". Null for
   * accounts created before batches existed (reported as "Ungrouped").
   */
  batchLabel: string | null;
}

/** JSON shape of an account as returned by the admin accounts API. */
export interface SerializedAccount {
  id: string;
  name: string;
  role: AccountRole;
  createdAt: string;
  revokedAt: string | null;
  batchLabel: string | null;
}

export function serializeAccount(account: Account): SerializedAccount {
  return {
    id: account.id,
    name: account.name,
    role: account.role,
    createdAt: account.createdAt.toISOString(),
    revokedAt: account.revokedAt ? account.revokedAt.toISOString() : null,
    batchLabel: account.batchLabel,
  };
}

interface RawAccountRow extends Record<string, unknown> {
  id: string;
  name: string;
  role: AccountRole;
  code_hash: string;
  created_at: Date | string;
  revoked_at: Date | string | null;
  batch_label: string | null;
}

export const ACCOUNTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'learner')),
  code_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS accounts_role_idx ON accounts (role, revoked_at);

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS batch_label TEXT;
`;

const ACCOUNT_COLUMNS = 'id, name, role, code_hash, created_at, revoked_at, batch_label';

export async function ensureAccountsSchema(queryable: Queryable): Promise<void> {
  for (const sql of ACCOUNTS_SCHEMA.split(';')) {
    const statement = sql.trim();
    if (statement !== '') await queryable.query(statement);
  }
}

// Human-typeable alphabet: uppercase letters and digits, excluding
// visually-confusable characters (0/O, 1/I, L).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const generateRawCode = customAlphabet(CODE_ALPHABET, 10);

/** `XXXXX-XXXXX` display form. Hashing always uses the normalized raw form. */
function formatCode(raw: string): string {
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function hashCode(normalizedCode: string): string {
  return createHash('sha256').update(normalizedCode).digest('hex');
}

function newAccountId(): string {
  return `acct_${randomBytes(12).toString('hex')}`;
}

function toAccount(row: RawAccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
    revokedAt:
      row.revoked_at === null
        ? null
        : row.revoked_at instanceof Date
          ? row.revoked_at
          : new Date(row.revoked_at),
    batchLabel: row.batch_label ?? null,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

/**
 * Create a new account with a freshly generated access code. Retries on the
 * astronomically unlikely event of a code collision.
 */
export async function createAccount(
  queryable: Queryable,
  name: string,
  role: AccountRole,
  batchLabel?: string | null,
): Promise<{ account: Account; code: string }> {
  const trimmedName = name.trim();
  const label = normalizeBatchLabel(batchLabel);
  if (!trimmedName) throw new Error('Account name is required');

  for (let attempt = 0; attempt < 5; attempt++) {
    const raw = generateRawCode();
    const codeHash = hashCode(raw);
    const id = newAccountId();
    try {
      const result = await queryable.query<RawAccountRow>(
        `INSERT INTO accounts (id, name, role, code_hash, batch_label)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${ACCOUNT_COLUMNS}`,
        [id, trimmedName, role, codeHash, label],
      );
      return { account: toAccount(result.rows[0]), code: formatCode(raw) };
    } catch (error) {
      if (!isUniqueViolation(error) || attempt === 4) throw error;
    }
  }
  throw new Error('Failed to generate a unique access code');
}

export async function listAccounts(queryable: Queryable): Promise<Account[]> {
  const result = await queryable.query<RawAccountRow>(
    `SELECT ${ACCOUNT_COLUMNS}
       FROM accounts
      ORDER BY created_at DESC`,
  );
  return result.rows.map(toAccount);
}

export async function countAccounts(queryable: Queryable): Promise<number> {
  const result = await queryable.query<{ count: string } & Record<string, unknown>>(
    'SELECT count(*)::text AS count FROM accounts',
  );
  return Number(result.rows[0]?.count ?? '0');
}

/** Revoke an account. Idempotent: revoking an already-revoked account still reports success. */
export async function revokeAccount(queryable: Queryable, id: string): Promise<boolean> {
  const result = await queryable.query<{ id: string } & Record<string, unknown>>(
    `UPDATE accounts SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING id`,
    [id],
  );
  if (result.rows.length === 1) return true;

  const existing = await queryable.query<{ id: string } & Record<string, unknown>>(
    'SELECT id FROM accounts WHERE id = $1',
    [id],
  );
  return existing.rows.length === 1;
}

/**
 * Set (or clear, with null/empty) an account's batch label. Returns the
 * updated account, or null when no such account exists. Allowed on revoked
 * accounts too, so historical cohorts can still be tidied up.
 */
export async function updateAccountBatchLabel(
  queryable: Queryable,
  id: string,
  batchLabel: unknown,
): Promise<Account | null> {
  const result = await queryable.query<RawAccountRow>(
    `UPDATE accounts SET batch_label = $2 WHERE id = $1 RETURNING ${ACCOUNT_COLUMNS}`,
    [id, normalizeBatchLabel(batchLabel)],
  );
  const row = result.rows[0];
  return row ? toAccount(row) : null;
}

/** Look up an active (non-revoked) account by its submitted access code. */
export async function verifyAccountCode(
  queryable: Queryable,
  submittedCode: string,
): Promise<Account | null> {
  const normalized = normalizeCode(submittedCode);
  if (!normalized) return null;
  const codeHash = hashCode(normalized);
  const result = await queryable.query<RawAccountRow>(
    `SELECT ${ACCOUNT_COLUMNS}
       FROM accounts
      WHERE code_hash = $1 AND revoked_at IS NULL`,
    [codeHash],
  );
  const row = result.rows[0];
  return row ? toAccount(row) : null;
}

/** Look up an account (active or revoked) by id -- used for per-request revocation checks. */
export async function getAccountById(queryable: Queryable, id: string): Promise<Account | null> {
  const result = await queryable.query<RawAccountRow>(
    `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  return row ? toAccount(row) : null;
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export interface LoginResult {
  account: Account;
  /** Set only the moment the bootstrap admin account is created. */
  bootstrapCode?: string;
}

/**
 * Verify a submitted login code against real accounts first, then fall back
 * to the one-time `ACCESS_CODE` bootstrap path when no accounts exist yet.
 * Bootstrapping creates the first individual admin account with its own
 * freshly generated code (returned once) -- `ACCESS_CODE` itself is never
 * stored, so it stops matching anything the moment an account exists.
 */
export async function verifyLoginCode(
  queryable: Queryable,
  submittedCode: string,
): Promise<LoginResult | null> {
  const account = await verifyAccountCode(queryable, submittedCode);
  if (account) return { account };

  const bootstrapCode = process.env.ACCESS_CODE;
  if (!bootstrapCode || !safeEqual(submittedCode, bootstrapCode)) return null;

  // Small race window if two bootstrap attempts land at once -- acceptable
  // for a one-time, single-operator setup step on a small deployment.
  const existing = await countAccounts(queryable);
  if (existing > 0) return null;

  const { account: created, code } = await createAccount(queryable, 'Admin', 'admin');
  return { account: created, bootstrapCode: code };
}
