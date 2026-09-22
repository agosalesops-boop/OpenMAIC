/**
 * Minimal per-learner course completion tracking.
 *
 * A learner self-reports completion via a "Mark as complete" button in the
 * classroom viewer; there is no automatic detection of course progress. A
 * completion is idempotent -- re-marking an already-completed course keeps
 * the original `completed_at` rather than bumping it.
 *
 * `stage_id` is a soft reference into the owner-scoped document store, same
 * as course_assignments.ts: a deleted course leaves an orphaned row here,
 * which admin views must tolerate.
 */
import type { Queryable } from '@openmaic/storage/document/pg';

export const COMPLETIONS_SCHEMA = `
CREATE TABLE IF NOT EXISTS completions (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, stage_id)
);

CREATE INDEX IF NOT EXISTS completions_account_idx ON completions (account_id);
`;

export async function ensureCompletionsSchema(queryable: Queryable): Promise<void> {
  for (const sql of COMPLETIONS_SCHEMA.split(';')) {
    const statement = sql.trim();
    if (statement !== '') await queryable.query(statement);
  }
}

interface CompletionRow extends Record<string, unknown> {
  stage_id: string;
  completed_at: Date | string;
}

/** Record a completion. Idempotent: a second call for the same pair is a no-op. */
export async function recordCompletion(
  queryable: Queryable,
  accountId: string,
  stageId: string,
): Promise<void> {
  await queryable.query(
    `INSERT INTO completions (account_id, stage_id)
     VALUES ($1, $2)
     ON CONFLICT (account_id, stage_id) DO NOTHING`,
    [accountId, stageId],
  );
}

/** Whether (and when) an account completed a specific course. */
export async function getCompletion(
  queryable: Queryable,
  accountId: string,
  stageId: string,
): Promise<Date | null> {
  const result = await queryable.query<CompletionRow>(
    'SELECT stage_id, completed_at FROM completions WHERE account_id = $1 AND stage_id = $2',
    [accountId, stageId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return row.completed_at instanceof Date ? row.completed_at : new Date(row.completed_at);
}

/** Every course an account has completed, for admin visibility. */
export async function listCompletionsForAccount(
  queryable: Queryable,
  accountId: string,
): Promise<{ stageId: string; completedAt: Date }[]> {
  const result = await queryable.query<CompletionRow>(
    'SELECT stage_id, completed_at FROM completions WHERE account_id = $1',
    [accountId],
  );
  return result.rows.map((row) => ({
    stageId: row.stage_id,
    completedAt: row.completed_at instanceof Date ? row.completed_at : new Date(row.completed_at),
  }));
}
