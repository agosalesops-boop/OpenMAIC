'use client';

/**
 * Admin-only at-a-glance progress strip for the front page: active learners,
 * total courses and average completion, with a link to the full report.
 * Renders nothing until data loads, and nothing at all if the summary can't
 * be fetched (e.g. a non-admin session) -- it never shows an error state on
 * the front page. The caller must only mount this for admin sessions.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, BookOpen, TrendingUp, Users } from 'lucide-react';

import { useI18n } from '@/lib/hooks/use-i18n';
import {
  summarizeForStrip,
  type DashboardSummary,
  type StripStats,
} from '@/lib/reporting/dashboard';

export function AdminProgressStrip() {
  const { t } = useI18n();
  const [stats, setStats] = useState<StripStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/dashboard/summary')
      .then((res) => {
        if (!res.ok) throw new Error('failed');
        return res.json() as Promise<DashboardSummary>;
      })
      .then((summary) => {
        if (!cancelled) setStats(summarizeForStrip(summary));
      })
      .catch(() => {
        // Stay hidden -- the front page is not the place for an error card.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!stats) return null;

  const items = [
    { icon: Users, label: t('admin.stripActiveLearners'), value: String(stats.activeLearners) },
    { icon: BookOpen, label: t('admin.stripCourses'), value: String(stats.totalCourses) },
    {
      icon: TrendingUp,
      label: t('admin.stripAvgCompletion'),
      value: stats.averageCompletion === null ? '—' : `${stats.averageCompletion}%`,
    },
  ];

  return (
    <div className="relative z-10 mt-10 w-full max-w-6xl">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-border/60 bg-white/70 dark:bg-slate-900/60 backdrop-blur px-4 py-3 shadow-sm">
        {items.map(({ icon: Icon, label, value }) => (
          <div key={label} className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">{label}</span>
            <span className="text-sm font-semibold tabular-nums">{value}</span>
          </div>
        ))}
        <Link
          href="/admin?tab=reports"
          className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          {t('admin.stripViewReport')}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
