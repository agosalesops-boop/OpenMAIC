import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAccount, ensureAccountsSchema } from '@/lib/persistence/accounts';
import { ensureCompletionsSchema, recordCompletion } from '@/lib/persistence/completions';
import {
  ensureCourseAssignmentsSchema,
  setAssignedStageIds,
} from '@/lib/persistence/course-assignments';
import { listAllAssignments, listAllCompletions } from '@/lib/persistence/reporting';

class PGlitePool {
  constructor(readonly db: PGlite) {}

  query(text: string, params?: unknown[]) {
    return this.db.query(text, params);
  }

  async end() {
    await this.db.close();
  }
}

describe('reporting bulk reads', () => {
  let pool: PGlitePool;

  beforeEach(async () => {
    const db = new PGlite();
    await db.waitReady;
    pool = new PGlitePool(db);
    await ensureAccountsSchema(pool as never);
    await ensureCourseAssignmentsSchema(pool as never);
    await ensureCompletionsSchema(pool as never);
  });

  afterEach(async () => {
    await pool.end();
  });

  it('returns empty maps when nothing is recorded', async () => {
    expect((await listAllAssignments(pool as never)).size).toBe(0);
    expect((await listAllCompletions(pool as never)).size).toBe(0);
  });

  it('groups assignments and completions by account', async () => {
    const { account: a } = await createAccount(pool as never, 'A', 'learner');
    const { account: b } = await createAccount(pool as never, 'B', 'learner');
    await setAssignedStageIds(pool as never, a.id, ['s1', 's2']);
    await recordCompletion(pool as never, a.id, 's1');
    await recordCompletion(pool as never, b.id, 's3');

    const assignments = await listAllAssignments(pool as never);
    expect([...(assignments.get(a.id) ?? [])].sort()).toEqual(['s1', 's2']);
    expect(assignments.has(b.id)).toBe(false); // b is unrestricted

    const completions = await listAllCompletions(pool as never);
    expect(completions.get(a.id)?.get('s1')).toBeInstanceOf(Date);
    expect(completions.get(a.id)?.has('s2')).toBe(false);
    expect([...(completions.get(b.id)?.keys() ?? [])]).toEqual(['s3']);
  });
});
