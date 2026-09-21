import { BrowserKVStore, HttpDocumentStore, type HttpDocumentHeadersHook } from '@openmaic/storage';
import { HttpRuntimeStore, type HttpRuntimeHeadersHook } from '@openmaic/storage/runtime/http';
import { HttpAssetStore, type HttpAssetHeadersHook } from '@openmaic/storage/asset/http';

import {
  assertDocumentStorageConfigurable,
  configureDocumentStorage,
  type DocumentStorageOptions,
} from '@/lib/document-store/config';
import { assertRuntimeStorageConfigurable, configureRuntimeStorage } from '@/lib/runtime/config';
import { getLearnerKey } from '@/lib/runtime/learner-key';
import {
  assertAssetPoolStorageConfigurable,
  configureAssetPoolStorage,
} from '@/lib/media/asset-pool-config';

let deviceKv: BrowserKVStore | undefined;
let learnerKeyPromise: Promise<string> | undefined;

export function isBrowserPersistenceEnabled(): boolean {
  return typeof window !== 'undefined' && process.env.NEXT_PUBLIC_PERSISTENCE === '1';
}

export function getPersistenceLearnerKey(): Promise<string> {
  if (!isBrowserPersistenceEnabled()) {
    return Promise.reject(new Error('Browser persistence is not enabled'));
  }
  return (learnerKeyPromise ??= getLearnerKey((deviceKv ??= new BrowserKVStore())).catch(
    (error) => {
      learnerKeyPromise = undefined;
      throw error;
    },
  ));
}

export async function getPersistenceRequestHeaders(): Promise<Record<string, string>> {
  if (!isBrowserPersistenceEnabled()) return {};
  const resolvedLearnerKey = await getPersistenceLearnerKey();
  // Authentication is the signed `openmaic_access` session cookie (sent
  // automatically) verified by middleware -- no bearer token to attach here
  // any more. x-learner-key remains: a per-browser device partition key, not
  // a credential (see lib/persistence/server-auth.ts).
  return {
    'x-learner-key': resolvedLearnerKey,
  };
}

if (isBrowserPersistenceEnabled()) {
  const learnerKey = getPersistenceLearnerKey;
  const headers = getPersistenceRequestHeaders;

  const runtimeOptions = {
    store: () =>
      new HttpRuntimeStore({
        baseUrl: '/api/persistence',
        headers: headers satisfies HttpRuntimeHeadersHook,
      }),
    learnerKey,
  };
  const documentOptions: DocumentStorageOptions = {
    store: ({ validateScene, validateStage }) =>
      new HttpDocumentStore({
        baseUrl: '/api/persistence',
        headers: headers satisfies HttpDocumentHeadersHook,
        validateScene,
        validateStage,
      }),
  };
  // Server-backed so generated media (narration audio today; images/video if
  // added later) is fetchable from any browser or device, not just the one
  // that generated it -- without this, a learner opening a course on a
  // different device than the one it was built on gets silent narration.
  const assetOptions = {
    store: () =>
      new HttpAssetStore({
        baseUrl: '/api/persistence',
        headers: headers satisfies HttpAssetHeadersHook,
      }),
    serverBacked: true,
  };
  try {
    // All checks are mutation-free. Once they pass, the synchronous configure
    // calls cannot leave only a subset of the persistence seams configured.
    assertRuntimeStorageConfigurable();
    assertDocumentStorageConfigurable();
    assertAssetPoolStorageConfigurable();
    configureRuntimeStorage(runtimeOptions);
    configureDocumentStorage(documentOptions);
    configureAssetPoolStorage(assetOptions);
  } catch (error) {
    console.error(
      'FATAL: server-backed persistence bootstrap failed; no storage seam changes were applied',
      error,
    );
  }
}
