'use client';

import {
  useEffect,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { useTranslations } from 'next-intl';
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { AiTryOnReferenceRole } from '@/hooks/api/types';

interface ReferenceLibraryModalProps {
  role: AiTryOnReferenceRole;
  libraryCountText: string;
  currentPage: number;
  totalPages: number;
  totalUnits: number;
  hasSelection: boolean;
  optional: boolean;
  children: ReactNode;
  onClose: () => void;
  onPageChange: Dispatch<SetStateAction<number>>;
  onClear: () => void;
}

export function ReferenceLibraryModal({
  role,
  libraryCountText,
  currentPage,
  totalPages,
  totalUnits,
  hasSelection,
  optional,
  children,
  onClose,
  onPageChange,
  onClear,
}: ReferenceLibraryModalProps) {
  const t = useTranslations('ImageTryOn');
  const r = useTranslations('ImageTryOn.referenceLibrary');

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowLeft')
        onPageChange(page => Math.max(1, page - 1));
      else if (event.key === 'ArrowRight')
        onPageChange(page => Math.min(totalPages, page + 1));
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [totalPages, onClose, onPageChange]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={r(`titles.${role}`)}
      data-testid={`library-modal-${role}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
      onClick={() => onClose()}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* 弹窗头部 */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-foreground">
              {r(`titles.${role}`)}
            </h3>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">
              {libraryCountText}
            </p>
          </div>
          <button
            type="button"
            aria-label={r('closeModal')}
            data-testid={`close-library-modal-${role}`}
            onClick={() => onClose()}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {children}

        {/* 弹窗底部分页与确认栏 */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/15 px-5 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid={`library-prev-page-${role}`}
              disabled={currentPage <= 1}
              onClick={() => onPageChange(page => Math.max(1, page - 1))}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2.5 font-mono text-xs text-foreground transition-colors hover:border-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              {r('previousPage')}
            </button>
            <span
              data-testid={`library-page-indicator-${role}`}
              className="px-2 font-mono text-xs text-muted-foreground"
            >
              {r('pageIndicator', {
                page: currentPage,
                pages: totalPages,
                count: totalUnits,
              })}
            </span>
            <button
              type="button"
              data-testid={`library-next-page-${role}`}
              disabled={currentPage >= totalPages}
              onClick={() =>
                onPageChange(page => Math.min(totalPages, page + 1))
              }
              className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2.5 font-mono text-xs text-foreground transition-colors hover:border-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              {r('nextPage')}
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            {hasSelection && optional && (
              <button
                type="button"
                onClick={() => onClear()}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
              >
                {t('clearSelection')}
              </button>
            )}
            <button
              type="button"
              data-testid={`confirm-library-modal-${role}`}
              onClick={() => onClose()}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-foreground px-4 font-mono text-xs text-background transition-opacity hover:opacity-90"
            >
              <Check className="h-3.5 w-3.5" />
              {r('done')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
