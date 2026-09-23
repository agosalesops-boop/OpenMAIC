'use client';

import Link from 'next/link';
import { ArrowLeft, BarChart3, Users } from 'lucide-react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useI18n } from '@/lib/hooks/use-i18n';
import { AccountsPanel } from './accounts-panel';
import { ReportsPanel } from './reports-panel';

export type AdminTab = 'learners' | 'reports';

/** Full-page admin area: Learners (account management) and Reports. */
export function AdminPage({ initialTab }: { initialTab: AdminTab }) {
  const { t } = useI18n();

  return (
    <div className="min-h-[100dvh] w-full bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-10">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('admin.backToCourses')}
        </Link>

        <h1 className="mt-4 text-2xl font-semibold tracking-tight">{t('admin.title')}</h1>

        <Tabs defaultValue={initialTab} className="mt-6 gap-6">
          <TabsList>
            <TabsTrigger value="learners" className="gap-1.5 px-3">
              <Users className="h-4 w-4" />
              {t('admin.tabLearners')}
            </TabsTrigger>
            <TabsTrigger value="reports" className="gap-1.5 px-3">
              <BarChart3 className="h-4 w-4" />
              {t('admin.tabReports')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="learners">
            <AccountsPanel />
          </TabsContent>
          <TabsContent value="reports">
            <ReportsPanel />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
