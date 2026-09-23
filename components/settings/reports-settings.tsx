'use client';

/**
 * Admin reporting dashboard (Batch 4): total courses, then learners grouped
 * by batch with per-learner completion and an expandable per-course
 * checklist. Read-only -- assignments are still changed from Accounts.
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Download,
  RefreshCw,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useI18n } from '@/lib/hooks/use-i18n';
import {
  buildDashboardCsv,
  groupLearnersByBatch,
  type DashboardSummary,
  type LearnerReport,
} from '@/lib/reporting/dashboard';

async function fetchDashboardSummary(): Promise<DashboardSummary> {
  const res = await fetch('/api/admin/dashboard/summary');
  if (!res.ok) throw new Error('failed');
  return res.json();
}

export function ReportsSettings() {
  const { t, locale } = useI18n();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showRevoked, setShowRevoked] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Initial load: state is only set in the async callbacks, never
  // synchronously in the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    let cancelled = false;
    fetchDashboardSummary()
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleRefresh() {
    setLoading(true);
    setLoadError(false);
    fetchDashboardSummary()
      .then((data) => setSummary(data))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }

  const groups = useMemo(() => {
    if (!summary) return [];
    const visible = showRevoked ? summary.learners : summary.learners.filter((l) => !l.revoked);
    return groupLearnersByBatch(visible);
  }, [summary, showRevoked]);

  const visibleLearnerCount = groups.reduce((n, g) => n + g.memberCount, 0);
  const revokedCount = summary?.learners.filter((l) => l.revoked).length ?? 0;

  function toggleLearner(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return iso;
    }
  }

  function handleExportCsv() {
    if (!summary) return;
    const csv = buildDashboardCsv(groups, {
      ungrouped: t('settings.reports.ungrouped'),
      active: t('settings.accounts.statusActive'),
      revoked: t('settings.accounts.statusRevoked'),
      assigned: t('settings.reports.scopeAssigned'),
      unrestricted: t('settings.reports.scopeUnrestricted'),
      yes: t('settings.reports.csvYes'),
      no: t('settings.reports.csvNo'),
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `learner-progress-${summary.generatedAt.slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function progressText(learner: LearnerReport): string {
    return learner.scope === 'assigned'
      ? t('settings.reports.progressAssigned', {
          done: String(learner.completedCount),
          total: String(learner.courseCount),
        })
      : t('settings.reports.progressLibrary', {
          done: String(learner.completedCount),
          total: String(learner.courseCount),
        });
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{t('settings.reports.description')}</p>

      {/* Top stats + actions */}
      <div className="flex flex-wrap items-stretch gap-3">
        <div className="rounded-lg border px-4 py-3 min-w-36">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <BookOpen className="h-3.5 w-3.5" />
            {t('settings.reports.totalCourses')}
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {summary ? summary.totalCourses : '…'}
          </div>
        </div>
        <div className="rounded-lg border px-4 py-3 min-w-36">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            {t('settings.reports.totalLearners')}
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {summary ? visibleLearnerCount : '…'}
          </div>
        </div>
        <div className="ml-auto flex flex-col items-end justify-between gap-2">
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={handleRefresh}
              disabled={loading}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              {t('settings.reports.refresh')}
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={handleExportCsv}
              disabled={!summary || visibleLearnerCount === 0}
            >
              <Download className="h-3.5 w-3.5" />
              {t('settings.reports.exportCsv')}
            </Button>
          </div>
          {revokedCount > 0 && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <Checkbox
                checked={showRevoked}
                onCheckedChange={(checked) => setShowRevoked(checked === true)}
              />
              {t('settings.reports.showRevoked', { count: String(revokedCount) })}
            </label>
          )}
        </div>
      </div>

      {summary === null && !loadError && (
        <p className="py-6 text-center text-sm text-muted-foreground">…</p>
      )}
      {loadError && (
        <p className="py-6 text-center text-sm text-destructive">
          {t('settings.reports.loadError')}
        </p>
      )}
      {summary !== null && groups.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t('settings.reports.emptyState')}
        </p>
      )}

      {/* Batches */}
      <div className="space-y-3">
        {groups.map((group) => (
          <Collapsible
            key={group.label ?? '__ungrouped__'}
            defaultOpen
            className="rounded-lg border overflow-hidden"
          >
            <CollapsibleTrigger className="group flex w-full items-center gap-2 bg-muted/40 px-3 py-2.5 text-left">
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
              <span
                className={`font-medium ${group.label === null ? 'italic text-muted-foreground' : ''}`}
              >
                {group.label ?? t('settings.reports.ungrouped')}
              </span>
              <span className="text-xs text-muted-foreground">
                {t('settings.reports.memberCount', { count: String(group.memberCount) })}
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                {group.averageCompletionPercent === null
                  ? t('settings.reports.avgNone')
                  : t('settings.reports.avgAssigned', {
                      percent: String(group.averageCompletionPercent),
                    })}
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-t">
                    <th className="text-left font-medium px-3 py-2">
                      {t('settings.reports.tableLearner')}
                    </th>
                    <th className="text-left font-medium px-3 py-2">
                      {t('settings.reports.tableScope')}
                    </th>
                    <th className="text-left font-medium px-3 py-2">
                      {t('settings.reports.tableProgress')}
                    </th>
                    <th className="text-right font-medium px-3 py-2 w-16">%</th>
                  </tr>
                </thead>
                <tbody>
                  {group.learners.map((learner) => {
                    const isOpen = expanded.has(learner.id);
                    return (
                      <Fragment key={learner.id}>
                        <tr
                          className="border-t cursor-pointer hover:bg-muted/30"
                          onClick={() => toggleLearner(learner.id)}
                        >
                          <td className="px-3 py-2.5">
                            <span className="inline-flex items-center gap-1.5 font-medium">
                              {isOpen ? (
                                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                              )}
                              {learner.name}
                              {learner.revoked && (
                                <Badge variant="destructive" className="ml-1">
                                  {t('settings.accounts.statusRevoked')}
                                </Badge>
                              )}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            {learner.scope === 'assigned' ? (
                              <Badge variant="secondary">
                                {t('settings.reports.scopeAssigned')}
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                title={t('settings.reports.unrestrictedHint')}
                              >
                                {t('settings.reports.scopeUnrestricted')}
                              </Badge>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <Progress
                                value={learner.completionPercent ?? 0}
                                className={`h-1.5 w-24 ${learner.scope === 'unrestricted' ? 'opacity-50' : ''}`}
                              />
                              <span className="text-xs text-muted-foreground whitespace-nowrap">
                                {progressText(learner)}
                              </span>
                            </div>
                          </td>
                          <td
                            className={`px-3 py-2.5 text-right tabular-nums ${learner.scope === 'unrestricted' ? 'text-muted-foreground' : 'font-medium'}`}
                          >
                            {learner.completionPercent === null
                              ? '—'
                              : `${learner.completionPercent}%`}
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="bg-muted/20">
                            <td colSpan={4} className="px-3 py-2">
                              {learner.courses.length === 0 ? (
                                <p className="py-1 pl-5 text-xs text-muted-foreground">
                                  {t('settings.reports.noCoursesInScope')}
                                </p>
                              ) : (
                                <ul className="space-y-1 pl-5">
                                  {learner.courses.map((course) => (
                                    <li
                                      key={course.stageId}
                                      className="flex items-center gap-2 text-xs"
                                    >
                                      {course.completed ? (
                                        <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                                      ) : (
                                        <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                                      )}
                                      <span
                                        className={`flex-1 truncate ${course.completed ? '' : 'text-muted-foreground'}`}
                                      >
                                        {course.name}
                                      </span>
                                      <span className="text-muted-foreground whitespace-nowrap">
                                        {course.completedAt
                                          ? t('settings.reports.completedOn', {
                                              date: formatDate(course.completedAt),
                                            })
                                          : t('settings.reports.notCompleted')}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </div>

      {summary !== null && groups.some((g) => g.unrestrictedCount > 0) && (
        <p className="text-xs text-muted-foreground">
          {t('settings.reports.unrestrictedFootnote')}
        </p>
      )}
    </div>
  );
}
