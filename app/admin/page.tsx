/**
 * /admin -- the admin area (Learners + Reports), moved out of the Settings
 * dialog. Admin-only, enforced here on the server: middleware verifies the
 * session cookie against the live accounts table and stamps `x-access-role`
 * (stripping any client-supplied copy), so a learner -- or anyone not logged
 * in -- is redirected to the front page before any admin UI is rendered.
 * The data behind both tabs is independently admin-gated by its API routes.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { AdminPage } from '@/components/admin/admin-page';

export const dynamic = 'force-dynamic';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const requestHeaders = await headers();
  if (requestHeaders.get('x-access-role') !== 'admin') redirect('/');

  const { tab } = await searchParams;
  return <AdminPage initialTab={tab === 'reports' ? 'reports' : 'learners'} />;
}
