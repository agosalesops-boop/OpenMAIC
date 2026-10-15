'use client';

import { motion } from 'motion/react';
import { BookOpen } from 'lucide-react';

import { useI18n } from '@/lib/hooks/use-i18n';

/**
 * Front-page greeting for learner logins, shown in place of the
 * course-generation box (learners can't create courses). The course library
 * renders directly below it on the home page.
 */
export function LearnerWelcome({ name }: { name: string | null }) {
  const { t } = useI18n();

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.35 }}
      className="w-full rounded-2xl border border-border/60 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl shadow-xl shadow-black/[0.03] dark:shadow-black/20 px-6 py-5"
    >
      <h2 className="text-lg font-semibold">
        {name ? t('home.learnerWelcomeName', { name }) : t('home.learnerWelcome')}
      </h2>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
        <BookOpen className="h-4 w-4 shrink-0" />
        {t('home.learnerWelcomeHint')}
      </p>
    </motion.div>
  );
}
