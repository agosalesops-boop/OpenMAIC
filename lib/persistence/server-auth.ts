/**
 * Authentication for the embedded persistence route's runtime and asset
 * requests (document requests use a server-resolved owner elsewhere, see
 * `app/api/persistence/[...path]/route.ts`).
 *
 * This delegates entirely to the session `middleware.ts` already verified:
 * every request that reaches this module has already passed through
 * middleware, which rejects anything without a validly signed, non-revoked
 * account cookie and forwards the verified identity via `x-access-role` /
 * `x-account-id` request headers -- headers a client cannot forge, since
 * Next strips/overwrites request headers set in middleware before the
 * request reaches app code.
 *
 * This module previously accepted a publicly-shipped shared bearer token
 * (`NEXT_PUBLIC_PERSISTENCE_TOKEN` / `PERSISTENCE_DEV_TOKEN`) instead, which
 * provided no real user isolation -- anyone who could load the page could
 * read and write every partition by supplying an arbitrary `x-learner-key`.
 * That flag is gone; real per-account session verification (via middleware)
 * is what gates this now.
 */
import type { IncomingMessage } from 'node:http';

import type { AssetPrincipal } from '@openmaic/storage';
import type { RuntimeHttpPrincipal } from '@openmaic/storage/server';

type PersistencePrincipal = RuntimeHttpPrincipal & Partial<Pick<AssetPrincipal, 'key'>>;

/**
 * The single asset partition for this deployment shape. Documents have no
 * ownership partition; assets get the same treatment until per-account asset
 * partitioning is worth building. The learner key still partitions runtime
 * sessions, which are genuinely per-browser state (see
 * `lib/runtime/learner-key.ts`) -- that's an orthogonal, device-scoped
 * identity, not a security boundary, so it's still taken from the
 * client-supplied `x-learner-key` header rather than the account id.
 */
const SHARED_ASSET_PRINCIPAL = 'shared';

function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function principalFor(
  role: string | undefined,
  learnerKey: string | undefined,
): PersistencePrincipal | undefined {
  if (role !== 'admin' && role !== 'learner') return undefined;
  return { key: SHARED_ASSET_PRINCIPAL, ...(learnerKey ? { learnerKey } : {}) };
}

export function authenticatePersistenceHeaders(headers: Headers): PersistencePrincipal | undefined {
  return principalFor(
    headers.get('x-access-role') ?? undefined,
    headers.get('x-learner-key') ?? undefined,
  );
}

export async function authenticatePersistenceRequest(
  req: IncomingMessage,
): Promise<PersistencePrincipal | undefined> {
  return principalFor(
    singleHeader(req.headers['x-access-role']),
    singleHeader(req.headers['x-learner-key']),
  );
}
