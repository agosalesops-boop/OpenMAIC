/**
 * Per-learner course assignment.
 *
 * A learner with zero rows here is unrestricted (sees every course in the
 * shared team library) -- this is the default for every account that
 * existed before this feature, and for a freshly created learner until an
 * admin assigns something. The moment an admin assigns at least one course
 * to a learner, that account becomes restricted to exactly its assigned set.
 * Admin accounts are never filtered by this table (enforced at the call
 * site, not here).
 *
 * `stage_id` is a soft reference into the owner-scoped document store (a
 * separate storage system from this accounts database), not a foreign key:
 * a course can be deleted from the workbench without this table knowing, so
 * callers must tolerate assignment rows that point at a course that no
 * longer exists.
 */
import type { Queryable } from '@openmaic/storage/document/pg';

export const COURSE_ASSIGNMENTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS course_assignments (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, stage_id)
);

CREATE INDEX IF NOT EXISTS course_assignments_account_idx ON course_assignments (account_id);
`;

export async function ensureCourseAssignmentsSchema(queryable: Queryable): Promise<void> {
  for (const sql of COURSE_ASSIGNMENTS_SCHEMA.split(';')) {
    const statement = sql.trim();
    if (statement !== '') await queryable.query(statement);
  }
}

/** The course ids explicitly assigned to an account. Empty means "unrestricted". */
export async function listAssignedStageIds(
  queryable: Queryable,
  accountId: string,
): Promise<string[]> {
  const result = await queryable.query<{ stage_id: string } & Record<string, unknown>>(
    'SELECT stage_id FROM course_assignments WHERE account_id = $1',
    [accountId],
  );
  return result.rows.map((row) => row.stage_id);
}

/**
 * Replace an account's full assignment set with exactly `stageIds`.
 *
 * Not wrapped in a single DB transaction (this is a low-frequency admin
 * action, not a hot write path) -- a crash between the delete and the
 * inserts would leave the set incomplete rather than corrupt, and the admin
 * UI re-reads and can simply retry.
 */
export async function setAssignedStageIds(
  queryable: Queryable,
  accountId: string,
  stageIds: string[],
): Promise<void> {
  await queryable.query('DELETE FROM course_assignments WHERE account_id = $1', [accountId]);
  const unique = Array.from(new Set(stageIds));
  for (const stageId of unique) {
    await queryable.query(
      `INSERT INTO course_assignments (account_id, stage_id)
       VALUES ($1, $2)
       ON CONFLICT (account_id, stage_id) DO NOTHING`,
      [accountId, stageId],
    );
  }
}
