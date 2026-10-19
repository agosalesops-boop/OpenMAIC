/**
 * Run the database schema setup once per deploy, serialized across server
 * instances.
 *
 * Every server instance used to run the full idempotent schema setup
 * (CREATE TABLE IF NOT EXISTS, DROP TRIGGER IF EXISTS + CREATE TRIGGER, ALTER
 * TABLE ...) on its first database use. On Vercel many instances cold-start at
 * once, and that DDL raced with itself (`trigger ... already exists`, 42710)
 * and, because DDL takes strong table locks, with ordinary queries from other
 * instances (`deadlock detected`). Either failure killed the request that hit
 * it -- including Pro-mode agent runs, which left chats unusable.
 *
 * Now:
 * - each setup group records the deploy it last ran for in a small
 *   `openmaic_schema_marker` table; cold starts of the same deploy see the
 *   marker and skip the DDL entirely (one cheap SELECT, no locks);
 * - the first instance of a new deploy runs the setup inside a transaction
 *   that first takes a transaction-scoped advisory lock, so concurrent first
 *   instances wait their turn, then re-check the marker and skip. A
 *   transaction-scoped lock (not a session lock) also works through Supabase's
 *   transaction-mode connection pooler.
 *
 * The deploy id comes from Vercel's system environment variables. Without one
 * (local dev, self-hosted, tests) the setup simply runs every time, as before.
 */
import type { Pool, PoolClient } from 'pg';

/** Arbitrary, fixed app-wide key for the schema-setup advisory lock. */
export const SCHEMA_INIT_LOCK_KEY = 727_151_001;

const MARKER_TABLE = 'openmaic_schema_marker';

type MaybePool = Pick<Pool, 'connect' | 'query'> | Record<string, unknown>;
type Runnable = PoolClient | MaybePool;

/** Identifies the running deploy, or null when unknown. */
export function schemaDeployId(
  env: Record<string, string | undefined> = process.env,
): string | null {
  return env.VERCEL_GIT_COMMIT_SHA?.trim() || env.VERCEL_DEPLOYMENT_ID?.trim() || null;
}

function isRealPool(pool: MaybePool): pool is Pick<Pool, 'connect' | 'query'> {
  return typeof (pool as { connect?: unknown }).connect === 'function';
}

async function markerMatches(
  queryable: { query: Pool['query'] },
  group: string,
  deployId: string,
): Promise<boolean> {
  const exists = await queryable.query<{ t: string | null }>(
    `SELECT to_regclass('${MARKER_TABLE}')::text AS t`,
  );
  if (!exists.rows[0]?.t) return false;
  const result = await queryable.query<{ value: string }>(
    `SELECT value FROM ${MARKER_TABLE} WHERE key = $1`,
    [group],
  );
  return result.rows[0]?.value === deployId;
}

/**
 * Run `setup` for schema group `group` at most once per deploy, serialized
 * across instances. Falls back to running `setup` directly on the given
 * object when there is no deploy id or it is not a real pool (unit-test fakes).
 */
export async function ensureSchemaOncePerDeploy(
  pool: MaybePool,
  group: string,
  setup: (queryable: Runnable) => Promise<void>,
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const deployId = schemaDeployId(env);
  if (!deployId || !isRealPool(pool)) {
    await setup(pool);
    return;
  }

  // Fast path: this deploy's setup already ran. No transaction, no locks.
  if (await markerMatches(pool, group, deployId)) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [SCHEMA_INIT_LOCK_KEY]);
    // Re-check under the lock: another instance may have just finished.
    if (!(await markerMatches(client, group, deployId))) {
      await setup(client);
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${MARKER_TABLE} (
           key TEXT PRIMARY KEY,
           value TEXT NOT NULL,
           updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
         )`,
      );
      await client.query(`ALTER TABLE ${MARKER_TABLE} ENABLE ROW LEVEL SECURITY`);
      await client.query(
        `INSERT INTO ${MARKER_TABLE} (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [group, deployId],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
