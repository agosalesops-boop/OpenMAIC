import { describe, expect, it } from 'vitest';

import { decideDocumentAccess, parseDocumentAction } from '@/lib/persistence/document-access';
import type { DocumentAction } from '@/lib/persistence/document-access';
import type { StageMetaRow } from '@/lib/persistence/stage-meta';

const OWNER = 'anon:owner-1';
const STAGE = 'stage-1';

function meta(overrides: Partial<StageMetaRow> = {}): StageMetaRow {
  return {
    stageId: STAGE,
    ownerId: OWNER,
    isPublic: false,
    publishedAt: null,
    generationComplete: true,
    deletedAt: null,
    ...overrides,
  };
}

/** Builds readMeta/documentExists stubs backed by a single in-memory row. */
function readers(row: StageMetaRow | null) {
  const readMeta = async () => row;
  const documentExists = async () => row !== null;
  return { readMeta, documentExists };
}

describe('decideDocumentAccess -- role gating (Batch 3)', () => {
  const cases: Array<{ kind: DocumentAction['kind']; action: DocumentAction }> = [
    { kind: 'write', action: { kind: 'write', stageId: STAGE } },
    { kind: 'delete', action: { kind: 'delete', stageId: STAGE } },
    { kind: 'create', action: { kind: 'create', stageId: STAGE } },
  ];

  for (const { kind, action } of cases) {
    it(`forbids a learner from ${kind}-ing a course it owns`, async () => {
      const { readMeta, documentExists } = readers(meta());
      const access = await decideDocumentAccess(
        action,
        OWNER,
        readMeta,
        documentExists,
        readMeta,
        'learner',
      );
      expect(access).toBe('forbid');
    });

    it(`forbids a request with no role from ${kind}-ing a course`, async () => {
      const { readMeta, documentExists } = readers(meta());
      const access = await decideDocumentAccess(action, OWNER, readMeta, documentExists, readMeta);
      expect(access).toBe('forbid');
    });

    it(`allows an admin who owns the course to ${kind} it`, async () => {
      const { readMeta, documentExists } = readers(kind === 'create' ? null : meta());
      const access = await decideDocumentAccess(
        action,
        OWNER,
        readMeta,
        documentExists,
        readMeta,
        'admin',
      );
      expect(access).toBe('allow');
    });

    it(`still forbids an admin from ${kind}-ing a course owned by someone else`, async () => {
      const { readMeta, documentExists } = readers(meta({ ownerId: 'anon:someone-else' }));
      const access = await decideDocumentAccess(
        action,
        OWNER,
        readMeta,
        documentExists,
        readMeta,
        'admin',
      );
      expect(access).toBe('forbid');
    });
  }

  it('lets a learner read a course it owns (viewing stays open)', async () => {
    const { readMeta, documentExists } = readers(meta());
    const access = await decideDocumentAccess(
      { kind: 'read', stageId: STAGE },
      OWNER,
      readMeta,
      documentExists,
      readMeta,
      'learner',
    );
    expect(access).toBe('allow');
  });

  it('lets a learner read a scene (asking questions / viewing during learning stays open)', async () => {
    const action = parseDocumentAction('GET', `/documents/${STAGE}/scenes/scene-1`);
    expect(action.kind).toBe('read');
    const { readMeta, documentExists } = readers(meta());
    const access = await decideDocumentAccess(action, OWNER, readMeta, documentExists, readMeta, 'learner');
    expect(access).toBe('allow');
  });

  it('still forbids list/unknown actions for a learner (unchanged pre-existing behavior)', async () => {
    const { readMeta, documentExists } = readers(null);
    const access = await decideDocumentAccess(
      { kind: 'list' },
      OWNER,
      readMeta,
      documentExists,
      readMeta,
      'learner',
    );
    expect(access).toBe('forbid');
  });

  it('forbids a learner from renaming a course via PUT .../stage', async () => {
    const action = parseDocumentAction('PUT', `/documents/${STAGE}/stage`);
    expect(action.kind).toBe('write');
    const { readMeta, documentExists } = readers(meta());
    const access = await decideDocumentAccess(action, OWNER, readMeta, documentExists, readMeta, 'learner');
    expect(access).toBe('forbid');
  });

  it('forbids a learner from saving scene content via PUT .../scenes/{id}', async () => {
    const action = parseDocumentAction('PUT', `/documents/${STAGE}/scenes/scene-1`);
    expect(action.kind).toBe('write');
    const { readMeta, documentExists } = readers(meta());
    const access = await decideDocumentAccess(action, OWNER, readMeta, documentExists, readMeta, 'learner');
    expect(access).toBe('forbid');
  });

  it('still forbids access with no ownerId regardless of role', async () => {
    const { readMeta, documentExists } = readers(meta());
    const access = await decideDocumentAccess(
      { kind: 'write', stageId: STAGE },
      undefined,
      readMeta,
      documentExists,
      readMeta,
      'admin',
    );
    expect(access).toBe('forbid');
  });
});
