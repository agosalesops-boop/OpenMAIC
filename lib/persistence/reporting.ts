/**
 * Bulk reads for the admin reporting dashboard (Batch 4). One query per
 * table instead of one per learner, so the report stays a handful of
 * queries however many learners there are.
 */
import type { Queryable } from '@openmaic/storage/document/pg';

/** accountId -> assigned stage ids, for every account with assignments. */
export async function listAllAssignments(queryable: Queryable): Promise<Map<string, string[]>> {
  const result = await queryable.query<
    { account_id: string; stage_id: string } & Record<string, unknown>
  >('SELECT account_id, stage_id FROM course_assignments');
  const map = new Map<string, string[]>();
  for (const row of result.rows) {
    const list = map.get(row.account_id) ?? [];
    list.push(row.stage_id);
    map.set(row.account_id, list);
  }
  return map;
}

/** accountId -> (stageId -> completedAt), for every recorded completion. */
export async function listAllCompletions(
  queryable: Queryable,
): Promise<Map<string, Map<string, Date>>> {
  const result = await queryable.query<
    { account_id: string; stage_id: string; completed_at: Date | string } & Record<string, unknown>
  >('SELECT account_id, stage_id, completed_at FROM completions');
  const map = new Map<string, Map<string, Date>>();
  for (const row of result.rows) {
    const inner = map.get(row.account_id) ?? new Map<string, Date>();
    inner.set(
      row.stage_id,
      row.completed_at instanceof Date ? row.completed_at : new Date(row.completed_at),
    );
    map.set(row.account_id, inner);
  }
  return map;
}
