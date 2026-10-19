/**
 * Serialize database schema setup across server instances.
 *
 * Every server instance runs the idempotent schema setup (CREATE TABLE IF NOT
 * EXISTS, DROP TRIGGER IF EXISTS + CREATE TRIGGER, ...) when it first touches
 * the database. On Vercel many instances cold-start at once, and two of them
 * can interleave "drop trigger" / "create trigger" so one fails with
 * `trigger "openmaic_scene_revision_trigger" ... already exists` (42710).
 * That failed initialization then broke whatever request triggered it --
 * including Pro-mode agent runs, which left chats unusable.
 *
 * Running the whole setup inside one transaction that first takes a
 * transaction-scoped advisory lock makes concurrent instances wait their turn
 * instead of colliding. A transaction-scoped lock (not a session lock) also
 * works through Supabase's transaction-mode connection pooler.
 */
import type { Pool, PoolClient } from 'pg';

/** Arbitrary, fixed app-wide key for the schema-setup advisory lock. */
export const SCHEMA_INIT_LOCK_KEY = 727_151_001;

type MaybePool = Pick<Pool, 'connect'> | Record<string, unknown>;

/**
 * Run `body` with exclusive schema-setup rights. Falls back to running on the
 * given object directly when it is not a real pool (no `connect`), e.g. the
 * lightweight fakes used in unit tests.
 */
export async function withSchemaInitLock<T>(
  pool: MaybePool,
  body: (queryable: PoolClient | MaybePool) => Promise<T>,
): Promise<T> {
  if (typeof (pool as { connect?: unknown }).connect !== 'function') {
    return body(pool);
  }
  const client = await (pool as Pick<Pool, 'connect'>).connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [SCHEMA_INIT_LOCK_KEY]);
    const result = await body(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
