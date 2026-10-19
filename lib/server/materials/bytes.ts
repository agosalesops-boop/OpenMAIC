import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export type MaterialByteInput = Buffer | Uint8Array | Readable | ReadableStream<Uint8Array>;

export interface MaterialByteStore {
  put(key: string, body: MaterialByteInput, mime?: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

function nodeReadable(body: MaterialByteInput): Readable {
  if (body instanceof Readable) return body;
  if (body instanceof ReadableStream) return Readable.fromWeb(body as never);
  return Readable.from(body);
}

function safeLocalPath(root: string, key: string): string {
  const path = resolve(root, key);
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    throw new Error(`invalid material object key: ${key}`);
  }
  return path;
}

/** Local/self-hosted material byte storage, rooted under the runtime data directory. */
export class LocalMaterialByteStore implements MaterialByteStore {
  private readonly root: string;

  constructor(root: string = resolve(process.cwd(), 'data')) {
    this.root = resolve(root);
  }

  async put(key: string, body: MaterialByteInput, _mime?: string): Promise<void> {
    const path = safeLocalPath(this.root, key);
    await mkdir(dirname(path), { recursive: true });
    try {
      await pipeline(nodeReadable(body), createWriteStream(path));
    } catch (error) {
      await rm(path, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async get(key: string): Promise<Buffer> {
    return readFile(safeLocalPath(this.root, key));
  }

  async delete(key: string): Promise<void> {
    await rm(safeLocalPath(this.root, key), { force: true });
  }
}

let sharedStore: MaterialByteStore | null = null;

/**
 * Which byte layer material uploads use:
 * - `MATERIAL_BYTE_STORE=postgres` / `local` forces one explicitly;
 * - otherwise PostgreSQL on Vercel (whose filesystem is read-only, so local
 *   writes always fail) when DATABASE_URL is set, and the local `data/`
 *   directory everywhere else (self-hosted, dev, tests).
 */
export function selectMaterialByteStoreKind(
  env: Record<string, string | undefined> = process.env,
): 'postgres' | 'local' {
  const forced = env.MATERIAL_BYTE_STORE?.trim().toLowerCase();
  if (forced === 'postgres' || forced === 'local') return forced;
  return env.VERCEL && env.DATABASE_URL ? 'postgres' : 'local';
}

export function getMaterialByteStore(): MaterialByteStore {
  if (!sharedStore) {
    if (selectMaterialByteStoreKind() === 'postgres') {
      // Imported lazily so the local/test path never loads the DB provider.
      sharedStore = new LazyPgMaterialByteStore();
    } else {
      sharedStore = new LocalMaterialByteStore();
    }
  }
  return sharedStore;
}

/** Defers loading the PostgreSQL store (and its provider) until first use. */
class LazyPgMaterialByteStore implements MaterialByteStore {
  private inner: Promise<MaterialByteStore> | null = null;

  private store(): Promise<MaterialByteStore> {
    this.inner ??= (async () => {
      const [{ PgMaterialByteStore }, { getServerPersistenceProvider }] = await Promise.all([
        import('./pg-bytes'),
        import('@/lib/persistence/server-provider'),
      ]);
      return new PgMaterialByteStore(async () => {
        const { pool } = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
        return pool as never;
      });
    })();
    return this.inner;
  }

  async put(key: string, body: MaterialByteInput, mime?: string): Promise<void> {
    return (await this.store()).put(key, body, mime);
  }

  async get(key: string): Promise<Buffer> {
    return (await this.store()).get(key);
  }

  async delete(key: string): Promise<void> {
    return (await this.store()).delete(key);
  }
}

export function setMaterialByteStoreForTests(store: MaterialByteStore | null): void {
  sharedStore = store;
}
