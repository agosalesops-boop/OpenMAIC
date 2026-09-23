/**
 * Admin reporting dashboard (Batch 4) -- pure, client-safe helpers.
 *
 * Shared by the summary API route (building per-learner reports from raw
 * rows), the Reports settings screen (grouping learners into batches) and
 * the CSV export, so all three agree on the numbers.
 *
 * Scope rules, mirroring course-assignments.ts:
 * - A learner with at least one assignment row is "assigned": progress is
 *   measured against the assigned courses that still exist in the library
 *   (assignment rows pointing at deleted courses are ignored).
 * - A learner with zero assignment rows is "unrestricted": they can see the
 *   whole library, but nothing was explicitly assigned, so they are labelled
 *   separately and shown progress "of the library" rather than "of assigned".
 *   Unrestricted learners are left out of batch averages, which only cover
 *   explicitly assigned work.
 */

export type LearnerScope = 'assigned' | 'unrestricted';

export interface ReportCourse {
  id: string;
  name: string;
}

export interface LearnerCourseStatus {
  stageId: string;
  name: string;
  completed: boolean;
  /** ISO timestamp, null when not completed. */
  completedAt: string | null;
}

export interface LearnerReport {
  id: string;
  name: string;
  batchLabel: string | null;
  revoked: boolean;
  /** ISO timestamp of account creation. */
  createdAt: string;
  scope: LearnerScope;
  /** Assigned-course count, or the whole library's size when unrestricted. */
  courseCount: number;
  completedCount: number;
  /** 0-100, rounded; null when there is nothing to measure against. */
  completionPercent: number | null;
  courses: LearnerCourseStatus[];
}

export interface DashboardSummary {
  generatedAt: string;
  totalCourses: number;
  courses: ReportCourse[];
  learners: LearnerReport[];
}

export interface BatchGroup {
  /** null = the "Ungrouped" bucket. */
  label: string | null;
  learners: LearnerReport[];
  memberCount: number;
  assignedCount: number;
  unrestrictedCount: number;
  /** Mean completion % across assigned-scope learners only; null if none. */
  averageCompletionPercent: number | null;
}

export interface LearnerInput {
  id: string;
  name: string;
  batchLabel: string | null;
  createdAt: Date;
  revokedAt: Date | null;
}

export interface BuildSummaryInput {
  courses: ReportCourse[];
  learners: LearnerInput[];
  /** accountId -> assigned stage ids (absent/empty = unrestricted). */
  assignments: Map<string, string[]>;
  /** accountId -> (stageId -> completedAt). */
  completions: Map<string, Map<string, Date>>;
  now?: Date;
}

function percent(done: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((done / total) * 100);
}

export function buildLearnerReport(
  learner: LearnerInput,
  courses: ReportCourse[],
  assignedIds: string[] | undefined,
  completedAt: Map<string, Date> | undefined,
): LearnerReport {
  const unrestricted = !assignedIds || assignedIds.length === 0;
  const assignedSet = new Set(assignedIds ?? []);
  const inScope = unrestricted ? courses : courses.filter((c) => assignedSet.has(c.id));

  const statuses: LearnerCourseStatus[] = inScope.map((course) => {
    const at = completedAt?.get(course.id) ?? null;
    return {
      stageId: course.id,
      name: course.name,
      completed: at !== null,
      completedAt: at ? at.toISOString() : null,
    };
  });
  const completedCount = statuses.filter((s) => s.completed).length;

  return {
    id: learner.id,
    name: learner.name,
    batchLabel: learner.batchLabel,
    revoked: learner.revokedAt !== null,
    createdAt: learner.createdAt.toISOString(),
    scope: unrestricted ? 'unrestricted' : 'assigned',
    courseCount: statuses.length,
    completedCount,
    completionPercent: percent(completedCount, statuses.length),
    courses: statuses,
  };
}

export function buildDashboardSummary(input: BuildSummaryInput): DashboardSummary {
  const courses = [...input.courses].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
  );
  return {
    generatedAt: (input.now ?? new Date()).toISOString(),
    totalCourses: courses.length,
    courses,
    learners: input.learners.map((learner) =>
      buildLearnerReport(
        learner,
        courses,
        input.assignments.get(learner.id),
        input.completions.get(learner.id),
      ),
    ),
  };
}

const byName = (a: LearnerReport, b: LearnerReport) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/**
 * Group learners into batches. Labelled batches come first, newest cohort
 * first (by the most recently created member), then "Ungrouped" last.
 * Labels are matched exactly -- they are free text, so "Sept A" and
 * "sept a" are two different batches (fixable via the Accounts screen).
 */
export function groupLearnersByBatch(learners: LearnerReport[]): BatchGroup[] {
  const groups = new Map<string | null, LearnerReport[]>();
  for (const learner of learners) {
    const key = learner.batchLabel ?? null;
    const list = groups.get(key) ?? [];
    list.push(learner);
    groups.set(key, list);
  }

  const result: BatchGroup[] = [];
  for (const [label, members] of groups) {
    const assigned = members.filter((m) => m.scope === 'assigned');
    const measurable = assigned.filter((m) => m.completionPercent !== null);
    result.push({
      label,
      learners: [...members].sort(byName),
      memberCount: members.length,
      assignedCount: assigned.length,
      unrestrictedCount: members.length - assigned.length,
      averageCompletionPercent:
        measurable.length === 0
          ? null
          : Math.round(
              measurable.reduce((sum, m) => sum + (m.completionPercent ?? 0), 0) /
                measurable.length,
            ),
    });
  }

  const newest = (g: BatchGroup) =>
    g.learners.reduce((max, m) => (m.createdAt > max ? m.createdAt : max), '');
  return result.sort((a, b) => {
    if (a.label === null) return 1;
    if (b.label === null) return -1;
    const diff = newest(b).localeCompare(newest(a));
    return diff !== 0 ? diff : a.label.localeCompare(b.label);
  });
}

/** Front-page admin strip: the three at-a-glance numbers. */
export interface StripStats {
  activeLearners: number;
  totalCourses: number;
  /** Mean completion % across active learners with assigned courses; null if none. */
  averageCompletion: number | null;
}

export function summarizeForStrip(summary: DashboardSummary): StripStats {
  const active = summary.learners.filter((l) => !l.revoked);
  const measurable = active.filter((l) => l.scope === 'assigned' && l.completionPercent !== null);
  return {
    activeLearners: active.length,
    totalCourses: summary.totalCourses,
    averageCompletion:
      measurable.length === 0
        ? null
        : Math.round(
            measurable.reduce((sum, l) => sum + (l.completionPercent ?? 0), 0) / measurable.length,
          ),
  };
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

/**
 * Quote a CSV cell (RFC 4180) and neutralize spreadsheet formula injection:
 * a free-text value starting with = + - @ (or tab/CR) would otherwise be
 * executed as a formula when the file is opened in Excel/Sheets.
 */
export function csvCell(value: string | number | null): string {
  if (value === null) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export interface CsvLabels {
  ungrouped: string;
  active: string;
  revoked: string;
  assigned: string;
  unrestricted: string;
  yes: string;
  no: string;
}

export const DEFAULT_CSV_LABELS: CsvLabels = {
  ungrouped: 'Ungrouped',
  active: 'Active',
  revoked: 'Revoked',
  assigned: 'Assigned',
  unrestricted: 'Unrestricted (whole library)',
  yes: 'Yes',
  no: 'No',
};

export const CSV_HEADER = [
  'Batch',
  'Learner',
  'Account status',
  'Scope',
  'Learner courses',
  'Learner completed',
  'Learner completion %',
  'Course',
  'Course completed',
  'Completed on',
];

/**
 * One row per learner x in-scope course (a learner with no courses in scope
 * still gets one row with the course columns blank), grouped the same way
 * as the on-screen report. Starts with a UTF-8 BOM so Excel reads non-ASCII
 * names correctly.
 */
export function buildDashboardCsv(
  groups: BatchGroup[],
  labels: CsvLabels = DEFAULT_CSV_LABELS,
): string {
  const lines: string[] = [CSV_HEADER.map(csvCell).join(',')];
  for (const group of groups) {
    for (const learner of group.learners) {
      const base = [
        group.label ?? labels.ungrouped,
        learner.name,
        learner.revoked ? labels.revoked : labels.active,
        learner.scope === 'assigned' ? labels.assigned : labels.unrestricted,
        learner.courseCount,
        learner.completedCount,
        learner.completionPercent,
      ];
      if (learner.courses.length === 0) {
        lines.push([...base, null, null, null].map(csvCell).join(','));
        continue;
      }
      for (const course of learner.courses) {
        lines.push(
          [
            ...base,
            course.name,
            course.completed ? labels.yes : labels.no,
            course.completedAt ? course.completedAt.slice(0, 10) : null,
          ]
            .map(csvCell)
            .join(','),
        );
      }
    }
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}
