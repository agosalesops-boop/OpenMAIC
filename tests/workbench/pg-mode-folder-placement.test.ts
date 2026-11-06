// @vitest-environment jsdom

/**
 * PG-mode folder placement — which folder a course is in lives on the server.
 *
 * Placement used to be device-local (Dexie `stageFolders`), so a colleague or
 * an incognito window saw every folder empty. With server persistence on,
 * moves are saved through `POST /api/folders/members`, the listing takes each
 * course's folder from the server, and this browser's old local placements
 * are pushed up once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  memberships: [] as Array<{ stageId: string; folderId?: string }>,
  put: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));
vi.mock('@/lib/store/media-generation', () => ({
  useMediaGenerationStore: {
    getState: () => ({ revokeObjectUrls: vi.fn() }),
    setState: vi.fn(),
  },
}));
vi.mock('@/lib/document-store', () => ({
  getDocumentStore: () => ({ listDocuments: vi.fn() }),
  getLegacyDocumentStore: () => ({ listStages: vi.fn(), read: vi.fn() }),
}));
vi.mock('@/lib/utils/database', () => ({
  db: {
    stageFolders: {
      toArray: () => Promise.resolve(mocks.memberships),
      put: mocks.put,
    },
    folders: { toArray: () => Promise.resolve([]), get: vi.fn() },
    transaction: async (_mode: string, _tables: unknown, fn: () => Promise<void>) => fn(),
  },
}));
vi.mock('@/lib/utils/chat-storage', () => ({
  ChatStorageLockUnavailableError: class extends Error {},
  saveChatSessions: vi.fn(),
  loadChatSessions: vi.fn(),
  deleteChatSessions: vi.fn(),
}));
vi.mock('@/lib/playback/cursor', () => ({ clearCursor: vi.fn() }));
vi.mock('@/lib/quiz/persistence', () => ({ clearAllForScene: vi.fn() }));
vi.mock('@/lib/runtime/store', () => ({ beginStageRuntimeDeletionSafely: vi.fn() }));
vi.mock('@/lib/pbl/v2/runtime/drain', () => ({ clearStageDrainWatermarks: vi.fn() }));
vi.mock('@/lib/utils/chat-storage-lock', () => ({
  withRuntimeStorageExclusiveLockUntilSettled: vi.fn(),
  withRuntimeStorageSharedLock: vi.fn(),
}));

import {
  FOLDER_PLACEMENTS_SYNCED_KEY,
  listStages,
  localPlacementsToRepair,
  pushLocalPlacementsToServer,
  setStageFolder,
} from '@/lib/utils/stage-storage';

const STAGES = [
  {
    id: 'filed-on-server',
    name: 'A',
    sceneCount: 1,
    createdAt: 1,
    updatedAt: 3,
    folderId: 'f-server',
  },
  { id: 'unfiled-on-server', name: 'B', sceneCount: 1, createdAt: 1, updatedAt: 2 },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_PERSISTENCE', '1');
  localStorage.clear();
  mocks.memberships = [];
  mocks.put.mockReset().mockResolvedValue(undefined);
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/stages') return json({ stages: STAGES });
    if (url === '/api/folders/members') return json({ ok: true });
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function memberCalls() {
  return fetchMock.mock.calls
    .filter(([url]) => String(url) === '/api/folders/members')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
}

describe('setStageFolder (PG mode)', () => {
  it('saves the placement on the server, then caches it locally', async () => {
    await setStageFolder('unfiled-on-server', 'f-1');
    expect(memberCalls()).toEqual([{ stageId: 'unfiled-on-server', folderId: 'f-1' }]);
    expect(mocks.put).toHaveBeenCalledWith(
      expect.objectContaining({ stageId: 'unfiled-on-server', folderId: 'f-1' }),
    );
  });

  it('unfiles on the server with folderId null', async () => {
    await setStageFolder('filed-on-server', undefined);
    expect(memberCalls()).toEqual([{ stageId: 'filed-on-server', folderId: null }]);
  });

  it('refuses without touching the local cache when the server rejects', async () => {
    fetchMock.mockImplementation(async () => json({ error: { code: 'FOLDER_NOT_FOUND' } }, 404));
    await expect(setStageFolder('unfiled-on-server', 'gone')).rejects.toThrow('Folder not found');
    expect(mocks.put).not.toHaveBeenCalled();
  });
});

describe('listStages (PG mode)', () => {
  it("takes each course's folder from the server over a stale local row", async () => {
    mocks.memberships = [{ stageId: 'filed-on-server', folderId: 'f-stale-local' }];
    const stages = await listStages();
    expect(stages.find((s) => s.id === 'filed-on-server')?.folderId).toBe('f-server');
    expect(memberCalls()).toEqual([]);
  });

  it('fills and pushes up local placements the server does not have yet, once', async () => {
    mocks.memberships = [{ stageId: 'unfiled-on-server', folderId: 'f-local' }];
    const stages = await listStages();
    expect(stages.find((s) => s.id === 'unfiled-on-server')?.folderId).toBe('f-local');
    await vi.waitFor(() => expect(localStorage.getItem(FOLDER_PLACEMENTS_SYNCED_KEY)).toBe('1'));
    expect(memberCalls()).toEqual([{ stageId: 'unfiled-on-server', folderId: 'f-local' }]);
  });
});

describe('localPlacementsToRepair', () => {
  it('ignores unfiled rows, unknown courses, and courses the server already filed', () => {
    const repairs = localPlacementsToRepair(STAGES, [
      { stageId: 'unfiled-on-server', folderId: 'f-local' },
      { stageId: 'filed-on-server', folderId: 'f-other' },
      { stageId: 'deleted-course', folderId: 'f-x' },
      { stageId: 'unfiled-on-server-2' },
    ]);
    expect([...repairs]).toEqual([['unfiled-on-server', 'f-local']]);
  });

  it('returns nothing once this browser has synced', () => {
    localStorage.setItem(FOLDER_PLACEMENTS_SYNCED_KEY, '1');
    expect(
      localPlacementsToRepair(STAGES, [{ stageId: 'unfiled-on-server', folderId: 'f-local' }]).size,
    ).toBe(0);
  });
});

describe('pushLocalPlacementsToServer', () => {
  it('does not mark synced when a push fails, so it retries next time', async () => {
    fetchMock.mockImplementation(async () => json({}, 500));
    await pushLocalPlacementsToServer(new Map([['unfiled-on-server', 'f-local']]));
    expect(localStorage.getItem(FOLDER_PLACEMENTS_SYNCED_KEY)).toBeNull();
  });

  it('treats a vanished folder (404) as done', async () => {
    fetchMock.mockImplementation(async () => json({}, 404));
    await pushLocalPlacementsToServer(new Map([['unfiled-on-server', 'gone']]));
    expect(localStorage.getItem(FOLDER_PLACEMENTS_SYNCED_KEY)).toBe('1');
  });
});
