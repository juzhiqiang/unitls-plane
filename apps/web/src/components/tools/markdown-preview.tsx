'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

const MarkdownRenderer = dynamic(
  () => import('./markdown-renderer').then(module => module.MarkdownRenderer),
  {
    ssr: false,
    loading: () => <div aria-hidden className="min-h-[7rem] px-6 py-5" />,
  }
);

interface MarkdownPreviewProps {
  content: string;
  format: 'markdown' | 'text';
  className?: string;
  viewportClassName?: string;
  labelPreview?: string;
  labelSource?: string;
  labelCopy?: string;
  labelCopied?: string;
  labelLines?: string;
  labelChars?: string;
  labelWords?: string;
}

function countStats(content: string) {
  const lines = content.length === 0 ? 0 : content.split('\n').length;
  const chars = content.length;
  const words =
    content.trim().length === 0 ? 0 : content.trim().split(/\s+/).length;
  return { lines, chars, words };
}

function formatNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}K`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

interface SourceViewProps {
  content: string;
  ariaLabel?: string;
}

function SourceView({ content, ariaLabel }: SourceViewProps) {
  const lines = useMemo(() => content.split('\n'), [content]);
  const gutterWidth = `${Math.max(2, String(lines.length).length)}ch`;

  return (
    <div
      className="font-mono text-[12.5px] leading-6 text-foreground/90"
      role="region"
      aria-label={ariaLabel}
    >
      <ol className="m-0 p-0 list-none">
        {lines.map((line, idx) => (
          <li key={idx} className="flex">
            <span
              aria-hidden="true"
              className="shrink-0 select-none text-right pr-3 pl-1 text-muted-foreground/50 border-r border-border/60 tabular-nums"
              style={{ width: gutterWidth }}
            >
              {idx + 1}
            </span>
            <span className="flex-1 pl-3 whitespace-pre-wrap break-words">
              {line.length === 0 ? '​' : line}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function MarkdownPreview({
  content,
  format,
  className,
  viewportClassName,
  labelPreview = '预览',
  labelSource = '源码',
  labelCopy = '复制',
  labelCopied = '已复制',
  labelLines = '行',
  labelChars = '字符',
  labelWords = '字',
}: MarkdownPreviewProps) {
  const [showSource, setShowSource] = useState(format === 'text');
  const [copied, setCopied] = useState(false);

  const stats = useMemo(() => countStats(content), [content]);

  const isMarkdown = format === 'markdown';
  const typeBadge = isMarkdown ? 'MD' : 'TXT';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border border-border bg-card',
        className
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/10 px-3 h-9">
        <div className="flex items-center gap-4 min-w-0">
          <span className="text-[10px] font-mono text-muted-foreground tracking-wider shrink-0">
            [{typeBadge}]
          </span>
          {isMarkdown && (
            <div className="flex items-center gap-0 h-9">
              <button
                type="button"
                onClick={() => setShowSource(false)}
                className={cn(
                  'h-9 px-0 mr-4 text-[10px] font-mono uppercase tracking-wider transition-colors border-b-[1.5px] -mb-px',
                  !showSource
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
                aria-pressed={!showSource}
              >
                {labelPreview}
              </button>
              <button
                type="button"
                onClick={() => setShowSource(true)}
                className={cn(
                  'h-9 px-0 text-[10px] font-mono uppercase tracking-wider transition-colors border-b-[1.5px] -mb-px',
                  showSource
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
                aria-pressed={showSource}
              >
                {labelSource}
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div
            className="hidden sm:flex items-center gap-2 text-[10px] font-mono text-muted-foreground tabular-nums"
            aria-label={`${stats.lines} ${labelLines}, ${stats.chars} ${labelChars}, ${stats.words} ${labelWords}`}
          >
            <span>
              <span className="text-foreground/80">
                {formatNumber(stats.lines)}
              </span>
              <span className="ml-1 uppercase tracking-wider">
                {labelLines}
              </span>
            </span>
            <span className="text-border">·</span>
            <span>
              <span className="text-foreground/80">
                {formatNumber(stats.chars)}
              </span>
              <span className="ml-1 uppercase tracking-wider">
                {labelChars}
              </span>
            </span>
            {isMarkdown && (
              <>
                <span className="text-border">·</span>
                <span>
                  <span className="text-foreground/80">
                    {formatNumber(stats.words)}
                  </span>
                  <span className="ml-1 uppercase tracking-wider">
                    {labelWords}
                  </span>
                </span>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className={cn(
              'h-6 px-2 text-[10px] font-mono uppercase tracking-wider border rounded transition-colors',
              copied
                ? 'border-accent text-accent bg-accent/10'
                : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/60'
            )}
            aria-label={copied ? labelCopied : labelCopy}
          >
            {copied ? labelCopied : labelCopy}
          </button>
        </div>
      </div>

      <div
        className={cn(
          'preview-scroll max-h-[640px] overflow-auto',
          viewportClassName
        )}
      >
        {isMarkdown && !showSource ? (
          <div className="markdown-body px-6 py-5 text-sm text-foreground">
            {content.trim().length === 0 ? (
              <EmptyHint />
            ) : (
              <MarkdownRenderer
                content={content}
                copyLabel={labelCopy}
                copiedLabel={labelCopied}
              />
            )}
          </div>
        ) : (
          <div className="py-4">
            {content.length === 0 ? (
              <div className="px-6">
                <EmptyHint />
              </div>
            ) : (
              <SourceView
                content={content}
                ariaLabel={isMarkdown ? labelSource : undefined}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyHint(): ReactNode {
  return <p className="text-xs font-mono text-muted-foreground">[ empty ]</p>;
}
