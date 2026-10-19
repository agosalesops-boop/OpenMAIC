/**
 * PostgreSQL-backed material byte storage.
 *
 * Workbench uploads ("Attach material" in Pro mode) originally wrote their
 * bytes to a local `data/` directory. Vercel's serverless filesystem is
 * read-only, so every upload failed there with a generic 500. This store
 * keeps the bytes in a `material_blobs` table in the same database instead.
 *
 * Uploads on Vercel are capped at ~4.5 MB per request by the platform, so
 * buffering a whole object in memory here is fine.
 */
import { Readable } from 'node:stream';

import type { Queryable } from '@openmaic/storage/document/pg';

import type { MaterialByteInput, MaterialByteStore } from './bytes';

/** Tables this store may use (fixed names only -- never user input). */
export type BlobTable = 'material_blobs' | 'classroom_media_blobs';

/** Schema for a blob table. RLS is on from creation (the app's role bypasses it). */
export function blobTableSchema(table: BlobTable): string {
  return `
CREATE TABLE IF NOT EXISTS ${table} (
  key TEXT PRIMARY KEY,
  mime TEXT,
  bytes BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
`;
}

export const MATERIAL_BLOBS_SCHEMA = blobTableSchema('material_blobs');

async function toBuffer(body: MaterialByteInput): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  const readable = body instanceof Readable ? body : Readable.fromWeb(body as never);
  const chunks: Buffer[] = [];
  for await (const chunk of readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

/** Same "missing object" signal as the filesystem store, so callers behave alike. */
function notFound(key: string): Error {
  const error = new Error(`material object not found: ${key}`) as Error & { code: string };
  error.code = 'ENOENT';
  return error;
}

export class PgMaterialByteStore implements MaterialByteStore {
  private schemaReady: Promise<void> | null = null;

  constructor(
    private readonly getQueryable: () => Promise<Queryable>,
    private readonly table: BlobTable = 'material_blobs',
  ) {
    if (table !== 'material_blobs' && table !== 'classroom_media_blobs') {
      throw new Error(`unsupported blob table: ${String(table)}`);
    }
  }

  private async db(): Promise<Queryable> {
    const queryable = await this.getQueryable();
    this.schemaReady ??= (async () => {
      for (const sql of blobTableSchema(this.table).split(';')) {
        const statement = sql.trim();
        if (statement !== '') await queryable.query(statement);
      }
    })().catch((error) => {
      this.schemaReady = null; // retry on the next call
      throw error;
    });
    await this.schemaReady;
    return queryable;
  }

  async put(key: string, body: MaterialByteInput, mime?: string): Promise<void> {
    // Consume the body first: the upload route's size meter throws mid-stream
    // when a file is too large, and nothing should be written in that case.
    const bytes = await toBuffer(body);
    const db = await this.db();
    await db.query(
      `INSERT INTO ${this.table} (key, mime, bytes) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET mime = EXCLUDED.mime, bytes = EXCLUDED.bytes`,
      [key, mime ?? null, bytes],
    );
  }

  async get(key: string): Promise<Buffer> {
    const db = await this.db();
    const result = await db.query<{ bytes: Buffer | Uint8Array } & Record<string, unknown>>(
      `SELECT bytes FROM ${this.table} WHERE key = $1`,
      [key],
    );
    const row = result.rows[0];
    if (!row) throw notFound(key);
    return Buffer.isBuffer(row.bytes) ? row.bytes : Buffer.from(row.bytes);
  }

  async delete(key: string): Promise<void> {
    const db = await this.db();
    await db.query(`DELETE FROM ${this.table} WHERE key = $1`, [key]);
  }
}
