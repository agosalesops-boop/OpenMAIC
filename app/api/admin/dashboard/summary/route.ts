/**
 * GET /api/admin/dashboard/summary -- the admin reporting dashboard's data
 * (Batch 4): total course count, plus one report per learner account (batch
 * label, scope, assigned/completed counts and a per-course checklist).
 *
 * Admin-only via requireAdminRole(). Read-only: nothing here mutates.
 *
 * The course library is read through the same owner-scoped document store
 * that GET /api/stages uses for admins (with SHARED_TEAM_OWNER_ID set, that
 * is the whole shared team library), so the course list here matches the
 * one in the per-learner "Courses" dialog exactly.
 */
import type { NextRequest } from 'next/server';

import { listAccounts } from '@/lib/persistence/accounts';
import { listAllAssignments, listAllCompletions } from '@/lib/persistence/reporting';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { buildDashboardSummary } from '@/lib/reporting/dashboard';
import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';
import { ownerJson } from '@/lib/server/agent-runtime/route-response';
import { withRequestOwnerId } from '@/lib/server/agent-runtime/with-owner';
import { apiError } from '@/lib/server/api-response';
import { requireAdminRole } from '@/lib/server/require-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = requireAdminRole(req);
  if (!('accountId' in guard)) return guard;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return apiError('INTERNAL_ERROR', 503, 'Server persistence not configured');
  }

  return withRequestOwnerId(req, async (ownerId, responseHeaders) => {
    const { pool } = await getServerPersistenceProvider(connectionString);
    const store = await getOwnerScopedDocumentStore(ownerId);

    const [documents, accounts, assignments, completions] = await Promise.all([
      store.listDocuments(),
      listAccounts(pool),
      listAllAssignments(pool),
      listAllCompletions(pool),
    ]);

    const summary = buildDashboardSummary({
      courses: documents.map((d) => ({ id: d.id, name: d.name })),
      learners: accounts.filter((a) => a.role === 'learner'),
      assignments,
      completions,
    });

    return ownerJson({ success: true, ...summary }, 200, responseHeaders);
  });
}
