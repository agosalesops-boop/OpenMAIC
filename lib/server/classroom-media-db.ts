/**
 * Database storage for classroom media files (`/api/classroom-media/...`).
 *
 * The workbench agent writes media it places into a course -- promoted
 * attachments, generated images/videos, generated narration -- under
 * `data/classrooms/<stageId>/{media,audio}/`. Vercel's filesystem is
 * read-only, so on Vercel those bytes go to a `classroom_media_blobs` table
 * instead and the serving route reads them back from there. Elsewhere
 * (self-hosted, dev, tests) the original local-disk behavior is unchanged.
 *
 * Uses the same switch as material uploads (`MATERIAL_BYTE_STORE`, or
 * automatically PostgreSQL on Vercel with a DATABASE_URL).
 */
import { selectMaterialByteStoreKind } from '@/lib/server/materials/bytes';
import type { PgMaterialByteStore } from '@/lib/server/materials/pg-bytes';

export function classroomMediaInDatabase(): boolean {
  return selectMaterialByteStoreKind() === 'postgres';
}

let storePromise: Promise<PgMaterialByteStore> | null = null;

function store(): Promise<PgMaterialByteStore> {
  storePromise ??= (async () => {
    const [{ PgMaterialByteStore }, { getServerPersistenceProvider }] = await Promise.all([
      import('@/lib/server/materials/pg-bytes'),
      import('@/lib/persistence/server-provider'),
    ]);
    return new PgMaterialByteStore(async () => {
      const { pool } = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
      return pool as never;
    }, 'classroom_media_blobs');
  })();
  return storePromise;
}

/** Storage key for one classroom media file, e.g. `stage-1/media/x.png`. */
export function classroomMediaKey(stageId: string, segments: string[]): string {
  return [stageId, ...segments].join('/');
}

export async function putClassroomMediaBlob(
  stageId: string,
  segments: string[],
  bytes: Buffer | Uint8Array,
  mime: string,
): Promise<void> {
  await (await store()).put(classroomMediaKey(stageId, segments), Buffer.from(bytes), mime);
}

/** The stored bytes, or null when there is no such file. */
export async function getClassroomMediaBlob(
  stageId: string,
  segments: string[],
): Promise<Buffer | null> {
  try {
    return await (await store()).get(classroomMediaKey(stageId, segments));
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return null;
    throw error;
  }
}
