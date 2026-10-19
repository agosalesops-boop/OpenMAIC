import { describe, expect, it, vi } from 'vitest';

import {
  ensureSchemaOncePerDeploy,
  SCHEMA_INIT_LOCK_KEY,
  schemaDeployId,
} from '@/lib/persistence/schema-init-lock';

/** A fake pg pool/client pair that records SQL and answers the marker checks. */
function fakePool(options: { markerTable: boolean; markerValue?: string }) {
  const calls: string[] = [];
  const answer = async (sql: string) => {
    calls.push(sql.trim().split(/\s+/).slice(0, 4).join(' '));
    if (sql.includes('to_regclass')) {
      return { rows: [{ t: options.markerTable ? 'openmaic_schema_marker' : null }] };
    }
    if (sql.startsWith('SELECT value FROM')) {
      return { rows: options.markerValue ? [{ value: options.markerValue }] : [] };
    }
    return { rows: [] };
  };
  const client = { query: vi.fn(answer), release: vi.fn() };
  const pool = { query: vi.fn(answer), connect: vi.fn(async () => client) };
  return { pool, client, calls };
}

const VERCEL = { VERCEL_GIT_COMMIT_SHA: 'sha-2' };

describe('schemaDeployId', () => {
  it('prefers the commit sha, then the deployment id, else null', () => {
    expect(schemaDeployId({ VERCEL_GIT_COMMIT_SHA: 'abc', VERCEL_DEPLOYMENT_ID: 'dpl' })).toBe(
      'abc',
    );
    expect(schemaDeployId({ VERCEL_DEPLOYMENT_ID: 'dpl' })).toBe('dpl');
    expect(schemaDeployId({})).toBeNull();
  });
});

describe('ensureSchemaOncePerDeploy', () => {
  it('runs setup directly (old behavior) when there is no deploy id', async () => {
    const { pool } = fakePool({ markerTable: false });
    const setup = vi.fn(async () => undefined);
    await ensureSchemaOncePerDeploy(pool, 'g', setup, {});
    expect(setup).toHaveBeenCalledWith(pool);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('runs setup directly on objects that are not real pools', async () => {
    const fake = { end: vi.fn() };
    const setup = vi.fn(async () => undefined);
    await ensureSchemaOncePerDeploy(fake, 'g', setup, VERCEL);
    expect(setup).toHaveBeenCalledWith(fake);
  });

  it('skips the DDL entirely when this deploy already ran it', async () => {
    const { pool } = fakePool({ markerTable: true, markerValue: 'sha-2' });
    const setup = vi.fn(async () => undefined);
    await ensureSchemaOncePerDeploy(pool, 'g', setup, VERCEL);
    expect(setup).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('runs setup once under the advisory lock for a new deploy and records it', async () => {
    const { pool, client } = fakePool({ markerTable: true, markerValue: 'sha-1' });
    const setup = vi.fn(async () => undefined);
    await ensureSchemaOncePerDeploy(pool, 'g', setup, VERCEL);

    expect(setup).toHaveBeenCalledWith(client);
    const sql = client.query.mock.calls.map((c) => String(c[0]));
    expect(sql[0]).toBe('BEGIN');
    expect(sql[1]).toContain('pg_advisory_xact_lock');
    expect(client.query.mock.calls[1]?.[1]).toEqual([SCHEMA_INIT_LOCK_KEY]);
    expect(sql.some((s) => s.includes('INSERT INTO openmaic_schema_marker'))).toBe(true);
    expect(sql[sql.length - 1]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rolls back and releases the client when setup fails', async () => {
    const { pool, client } = fakePool({ markerTable: false });
    const setup = vi.fn(async () => {
      throw new Error('ddl failed');
    });
    await expect(ensureSchemaOncePerDeploy(pool, 'g', setup, VERCEL)).rejects.toThrow('ddl failed');
    const sql = client.query.mock.calls.map((c) => String(c[0]));
    expect(sql).toContain('ROLLBACK');
    expect(sql).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });
});
