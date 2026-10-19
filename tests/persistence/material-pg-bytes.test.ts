import { Readable } from 'node:stream';

import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { selectMaterialByteStoreKind } from '@/lib/server/materials/bytes';
import { PgMaterialByteStore } from '@/lib/server/materials/pg-bytes';

class PGlitePool {
  constructor(readonly db: PGlite) {}

  query(text: string, params?: unknown[]) {
    return this.db.query(text, params);
  }

  async end() {
    await this.db.close();
  }
}

describe('PgMaterialByteStore', () => {
  let pool: PGlitePool;
  let store: PgMaterialByteStore;

  beforeEach(async () => {
    const db = new PGlite();
    await db.waitReady;
    pool = new PGlitePool(db);
    store = new PgMaterialByteStore(async () => pool as never);
  });

  afterEach(async () => {
    await pool.end();
  });

  it('round-trips, overwrites and deletes an object', async () => {
    const key = 'materials/owner-1/mat-1';
    await store.put(key, Buffer.from('first'), 'image/png');
    await expect(store.get(key)).resolves.toEqual(Buffer.from('first'));

    await store.put(key, Buffer.from('second'), 'image/png');
    await expect(store.get(key)).resolves.toEqual(Buffer.from('second'));

    await store.delete(key);
    await expect(store.get(key)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('accepts a streamed body', async () => {
    const key = 'materials/owner-1/streamed';
    await store.put(key, Readable.from([Buffer.from('ab'), Buffer.from('cd')]));
    await expect(store.get(key)).resolves.toEqual(Buffer.from('abcd'));
  });

  it('writes nothing when the body stream fails mid-way (e.g. a size cap)', async () => {
    const key = 'materials/owner-1/too-big';
    const failing = new Readable({
      read() {
        this.destroy(new Error('payload too large'));
      },
    });
    await expect(store.put(key, failing)).rejects.toThrow('payload too large');
    await expect(store.get(key)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('deleting a missing object is a no-op', async () => {
    await expect(store.delete('materials/none')).resolves.toBeUndefined();
  });
});

describe('PgMaterialByteStore (classroom media table)', () => {
  it('keeps classroom media in its own table', async () => {
    const db = new PGlite();
    await db.waitReady;
    const pool = new PGlitePool(db);
    try {
      const media = new PgMaterialByteStore(async () => pool as never, 'classroom_media_blobs');
      const materials = new PgMaterialByteStore(async () => pool as never);
      await media.put('stage-1/media/a.png', Buffer.from('png'), 'image/png');
      await expect(media.get('stage-1/media/a.png')).resolves.toEqual(Buffer.from('png'));
      await expect(materials.get('stage-1/media/a.png')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await pool.end();
    }
  });

  it('refuses table names outside the fixed list', () => {
    expect(() => new PgMaterialByteStore(async () => ({}) as never, 'users' as never)).toThrow(
      'unsupported blob table',
    );
  });
});

describe('selectMaterialByteStoreKind', () => {
  it('uses PostgreSQL on Vercel when a database is configured', () => {
    expect(selectMaterialByteStoreKind({ VERCEL: '1', DATABASE_URL: 'postgres://x' })).toBe(
      'postgres',
    );
  });

  it('keeps local disk elsewhere', () => {
    expect(selectMaterialByteStoreKind({ DATABASE_URL: 'postgres://x' })).toBe('local');
    expect(selectMaterialByteStoreKind({ VERCEL: '1' })).toBe('local');
  });

  it('honors an explicit override', () => {
    expect(
      selectMaterialByteStoreKind({ MATERIAL_BYTE_STORE: 'local', VERCEL: '1', DATABASE_URL: 'x' }),
    ).toBe('local');
    expect(selectMaterialByteStoreKind({ MATERIAL_BYTE_STORE: 'postgres' })).toBe('postgres');
  });
});
