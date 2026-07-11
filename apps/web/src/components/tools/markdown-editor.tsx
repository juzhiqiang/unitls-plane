'use client';

import { useMemo, useRef, type UIEvent } from 'react';
import { FileCode2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
}

function countMarkdownStats(value: string) {
  const lines = value.length === 0 ? 1 : value.split('\n').length;
  const chars = value.length;
  const words =
    value.trim().length === 0 ? 0 : value.trim().split(/\s+/).length;
  return { lines, chars, words };
}

export function MarkdownEditor({
  value,
  onChange,
  label,
  disabled,
}: MarkdownEditorProps) {
  const gutterRef = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => value.split('\n'), [value]);
  const stats = useMemo(() => countMarkdownStats(value), [value]);

  const handleScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    if (gutterRef.current) {
      gutterRef.current.scrollTop = event.currentTarget.scrollTop;
    }
  };

  return (
    <section className="overflow-hidden rounded-md border border-border bg-card">
      <div className="flex h-10 items-center justify-between gap-3 border-b border-border bg-muted/10 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <FileCode2 className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-xs font-mono uppercase tracking-wider text-foreground">
            {label}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[10px] font-mono text-muted-foreground tabular-nums">
          <span>{stats.lines} ln</span>
          <span className="text-border">/</span>
          <span>{stats.chars} ch</span>
          <span className="hidden sm:inline text-border">/</span>
          <span className="hidden sm:inline">{stats.words} wd</span>
        </div>
      </div>

      <div className="grid min-h-[520px] grid-cols-[3.75rem_minmax(0,1fr)] bg-background">
        <div
          ref={gutterRef}
          aria-hidden="true"
          className="preview-scroll overflow-hidden border-r border-border bg-muted/15 py-3 text-right font-mono text-[12px] leading-6 text-muted-foreground/60"
        >
          {lines.map((_, index) => (
            <div key={index} className="h-6 select-none pr-3 tabular-nums">
              {index + 1}
            </div>
          ))}
        </div>
        <textarea
          value={value}
          onChange={event => onChange(event.target.value)}
          onScroll={handleScroll}
          disabled={disabled}
          spellCheck={false}
          aria-label={label}
          className={cn(
            'preview-scroll min-h-[520px] w-full resize-y bg-transparent px-4 py-3',
            'font-mono text-[13px] leading-6 text-foreground outline-none',
            'selection:bg-accent/20 placeholder:text-muted-foreground',
            'disabled:opacity-50'
          )}
        />
      </div>
    </section>
  );
}
