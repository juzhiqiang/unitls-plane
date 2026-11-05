'use client';

import { useTranslations } from 'next-intl';
import { ProcessingProgress } from '@/components/tools/processing-progress';
import { FailureRecoveryPanel } from '@/components/tools/failure-recovery-panel';
import type { TryOnWorkbench } from './useTryOnWorkbench';

type TryOnTaskFeedbackProps = Pick<
  TryOnWorkbench,
  'task' | 'progressPercent' | 'progressLabel' | 'dynamicProgressPhase'
>;

export function TryOnTaskFeedback({
  task,
  progressPercent,
  progressLabel,
  dynamicProgressPhase,
}: TryOnTaskFeedbackProps) {
  const t = useTranslations('ImageTryOn');
  const {
    isBusy,
    effectiveTask,
    error,
    errorCode,
    taskFailureMessage,
    handleRegenerate,
    handleSubmit,
    handleReset,
  } = task;
  return (
    <>
      {/* 排队 / 处理中状态（阶段动态反馈） */}
      {isBusy && (
        <div className="space-y-1.5">
          <ProcessingProgress
            progress={progressPercent}
            label={progressLabel}
          />
          {effectiveTask?.status === 'processing' && (
            <p className="text-center font-mono text-xs text-muted-foreground animate-pulse">
              {dynamicProgressPhase}
            </p>
          )}
        </div>
      )}

      {/* 失败恢复面板（表单级报错或任务执行失败） */}
      {(error || taskFailureMessage) && (
        <FailureRecoveryPanel
          message={error ?? taskFailureMessage ?? t('errors.failed')}
          errorCode={errorCode ?? effectiveTask?.errorCode}
          onRetry={
            effectiveTask?.status === 'failed'
              ? handleRegenerate
              : () => void handleSubmit()
          }
          onReset={handleReset}
        />
      )}
    </>
  );
}
