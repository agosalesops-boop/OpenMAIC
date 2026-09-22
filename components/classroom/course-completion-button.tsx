'use client';

import { useEffect, useState } from 'react';
import { Check, GraduationCap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/hooks/use-i18n';
import { createLogger } from '@/lib/logger';

const log = createLogger('CourseCompletion');

/**
 * Floating self-report control for Batch 2's minimal completion tracking.
 * Sits alongside the course player without touching its internals -- fetches
 * its own status on mount and posts a completion on click. A 403 (no signed-in
 * account -- auth disabled, or the request predates middleware setting the
 * header) is treated as "nothing to show" rather than an error.
 */
export function CourseCompletionButton({ stageId }: { stageId: string }) {
  const { t } = useI18n();
  const [completed, setCompleted] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCompleted(null);
    fetch(`/api/stages/${encodeURIComponent(stageId)}/complete`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { completed: boolean }) => {
        if (!cancelled) setCompleted(data.completed);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setCompleted(null);
          log.warn('Failed to load completion status', error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [stageId]);

  if (completed === null) return null;

  async function handleClick() {
    if (completed) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/stages/${encodeURIComponent(stageId)}/complete`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(String(res.status));
      setCompleted(true);
    } catch (error) {
      log.warn('Failed to record completion', error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <Button
        size="sm"
        variant={completed ? 'secondary' : 'default'}
        disabled={saving || completed}
        onClick={handleClick}
        className="gap-1.5 shadow-lg"
      >
        {completed ? <Check className="h-4 w-4" /> : <GraduationCap className="h-4 w-4" />}
        {completed ? t('classroom.completion.completed') : t('classroom.completion.markComplete')}
      </Button>
    </div>
  );
}
