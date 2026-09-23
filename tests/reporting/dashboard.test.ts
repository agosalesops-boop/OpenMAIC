import { describe, expect, it } from 'vitest';

import {
  buildDashboardCsv,
  buildDashboardSummary,
  csvCell,
  groupLearnersByBatch,
  summarizeForStrip,
  type LearnerInput,
} from '@/lib/reporting/dashboard';

const courses = [
  { id: 'c2', name: 'Pricing 101' },
  { id: 'c1', name: 'Company Intro' },
  { id: 'c3', name: 'CRM Basics' },
];

function learner(
  id: string,
  batchLabel: string | null,
  createdAt = '2026-09-01T00:00:00Z',
  revoked = false,
): LearnerInput {
  return {
    id,
    name: id.toUpperCase(),
    batchLabel,
    createdAt: new Date(createdAt),
    revokedAt: revoked ? new Date('2026-09-20T00:00:00Z') : null,
  };
}

const done = (entries: Record<string, string>) =>
  new Map(Object.entries(entries).map(([k, v]) => [k, new Date(v)]));

describe('buildDashboardSummary', () => {
  const summary = buildDashboardSummary({
    courses,
    learners: [learner('ann', 'Sept A'), learner('bob', null), learner('cat', 'Sept A')],
    assignments: new Map([
      ['ann', ['c1', 'c2', 'deleted-course']],
      ['cat', ['deleted-course']],
    ]),
    completions: new Map([
      ['ann', done({ c1: '2026-09-10T08:00:00Z', 'deleted-course': '2026-09-05T00:00:00Z' })],
      ['bob', done({ c3: '2026-09-11T00:00:00Z' })],
    ]),
    now: new Date('2026-09-23T00:00:00Z'),
  });
  const byId = Object.fromEntries(summary.learners.map((l) => [l.id, l]));

  it('counts the whole library and sorts courses by name', () => {
    expect(summary.totalCourses).toBe(3);
    expect(summary.courses.map((c) => c.id)).toEqual(['c1', 'c3', 'c2']);
    expect(summary.generatedAt).toBe('2026-09-23T00:00:00.000Z');
  });

  it('measures assigned learners against existing assigned courses only', () => {
    expect(byId.ann.scope).toBe('assigned');
    expect(byId.ann.courseCount).toBe(2); // deleted course ignored
    expect(byId.ann.completedCount).toBe(1); // completion of deleted course ignored
    expect(byId.ann.completionPercent).toBe(50);
    expect(byId.ann.courses.find((c) => c.stageId === 'c1')?.completedAt).toBe(
      '2026-09-10T08:00:00.000Z',
    );
    expect(byId.ann.courses.find((c) => c.stageId === 'c2')?.completed).toBe(false);
  });

  it('labels learners with no assignments as unrestricted, against the library', () => {
    expect(byId.bob.scope).toBe('unrestricted');
    expect(byId.bob.courseCount).toBe(3);
    expect(byId.bob.completedCount).toBe(1);
    expect(byId.bob.completionPercent).toBe(33);
  });

  it('keeps an assigned learner whose only course was deleted as assigned with nothing to measure', () => {
    expect(byId.cat.scope).toBe('assigned');
    expect(byId.cat.courseCount).toBe(0);
    expect(byId.cat.completionPercent).toBeNull();
  });
});

describe('groupLearnersByBatch', () => {
  const summary = buildDashboardSummary({
    courses,
    learners: [
      learner('old1', 'Aug B', '2026-08-01T00:00:00Z'),
      learner('new1', 'Sept A', '2026-09-15T00:00:00Z'),
      learner('new2', 'Sept A', '2026-09-15T00:00:00Z'),
      learner('free', 'Sept A', '2026-09-15T00:00:00Z'),
      learner('legacy', null, '2026-09-20T00:00:00Z'),
    ],
    assignments: new Map([
      ['old1', ['c1']],
      ['new1', ['c1', 'c2']],
      ['new2', ['c1', 'c2']],
    ]),
    completions: new Map([
      ['new1', done({ c1: '2026-09-16T00:00:00Z', c2: '2026-09-17T00:00:00Z' })],
      [
        'free',
        done({
          c1: '2026-09-16T00:00:00Z',
          c2: '2026-09-16T00:00:00Z',
          c3: '2026-09-16T00:00:00Z',
        }),
      ],
    ]),
  });
  const groups = groupLearnersByBatch(summary.learners);

  it('orders newest cohort first and Ungrouped last', () => {
    expect(groups.map((g) => g.label)).toEqual(['Sept A', 'Aug B', null]);
  });

  it('averages only assigned learners, counting unrestricted ones separately', () => {
    const sept = groups[0];
    expect(sept.memberCount).toBe(3);
    expect(sept.assignedCount).toBe(2);
    expect(sept.unrestrictedCount).toBe(1);
    expect(sept.averageCompletionPercent).toBe(50); // (100 + 0) / 2; 'free' excluded
    expect(sept.learners.map((l) => l.id)).toEqual(['free', 'new1', 'new2']); // by name
  });

  it('reports no average when a batch has no assigned learners', () => {
    expect(groups[2].averageCompletionPercent).toBeNull();
  });

  it('treats labels as exact free text', () => {
    const split = groupLearnersByBatch(
      buildDashboardSummary({
        courses,
        learners: [learner('x', 'Sept A'), learner('y', 'sept a')],
        assignments: new Map(),
        completions: new Map(),
      }).learners,
    );
    expect(split).toHaveLength(2);
  });
});

describe('CSV export', () => {
  it('escapes quotes/commas/newlines and neutralizes formula injection', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell(null)).toBe('');
    expect(csvCell(42)).toBe('42');
  });

  it('writes one row per learner x course, with a BOM and a header', () => {
    const summary = buildDashboardSummary({
      courses: [
        { id: 'c1', name: 'Intro' },
        { id: 'c2', name: 'Pricing, advanced' },
      ],
      learners: [learner('ann', 'Sept A'), learner('zed', null)],
      assignments: new Map([['ann', ['c1']]]),
      completions: new Map([['ann', done({ c1: '2026-09-10T08:00:00Z' })]]),
    });
    const csv = buildDashboardCsv(groupLearnersByBatch(summary.learners));
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).trimEnd().split('\r\n');
    expect(lines[0]).toBe(
      'Batch,Learner,Account status,Scope,Learner courses,Learner completed,Learner completion %,Course,Course completed,Completed on',
    );
    expect(lines[1]).toBe('Sept A,ANN,Active,Assigned,1,1,100,Intro,Yes,2026-09-10');
    expect(lines[2]).toBe('Ungrouped,ZED,Active,Unrestricted (whole library),2,0,0,Intro,No,');
    expect(lines[3]).toBe(
      'Ungrouped,ZED,Active,Unrestricted (whole library),2,0,0,"Pricing, advanced",No,',
    );
    expect(lines).toHaveLength(4);
  });

  it('still emits a row for a learner with nothing in scope', () => {
    const summary = buildDashboardSummary({
      courses: [],
      learners: [learner('solo', null)],
      assignments: new Map(),
      completions: new Map(),
    });
    const lines = buildDashboardCsv(groupLearnersByBatch(summary.learners))
      .slice(1)
      .trimEnd()
      .split('\r\n');
    expect(lines[1]).toBe('Ungrouped,SOLO,Active,Unrestricted (whole library),0,0,,,,');
  });
});

describe('summarizeForStrip', () => {
  it('counts active learners and averages only active, assigned learners', () => {
    const summary = buildDashboardSummary({
      courses,
      learners: [
        learner('done', 'A'),
        learner('half', 'A'),
        learner('free', 'A'),
        learner('gone', 'A', '2026-09-01T00:00:00Z', true),
      ],
      assignments: new Map([
        ['done', ['c1']],
        ['half', ['c1', 'c2']],
        ['gone', ['c1']],
      ]),
      completions: new Map([
        ['done', done({ c1: '2026-09-10T00:00:00Z' })],
        ['half', done({ c1: '2026-09-10T00:00:00Z' })],
        ['free', done({ c1: '2026-09-10T00:00:00Z' })],
      ]),
    });
    // 'gone' is revoked (excluded); 'free' is unrestricted (not averaged).
    expect(summarizeForStrip(summary)).toEqual({
      activeLearners: 3,
      totalCourses: 3,
      averageCompletion: 75, // (100 + 50) / 2
    });
  });

  it('reports no average when nobody has assigned courses', () => {
    const summary = buildDashboardSummary({
      courses,
      learners: [learner('free', null)],
      assignments: new Map(),
      completions: new Map(),
    });
    expect(summarizeForStrip(summary).averageCompletion).toBeNull();
  });
});
