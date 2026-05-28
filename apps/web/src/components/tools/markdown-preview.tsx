'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { cn } from '@/lib/utils';

interface MarkdownPreviewProps {
  content: string;
  format: 'markdown' | 'text';
  labelPreview?: string;
  labelSource?: string;
}

export function MarkdownPreview({
  content,
  format,
  labelPreview = '预览',
  labelSource = '源码',
}: MarkdownPreviewProps) {
  const [showSource, setShowSource] = useState(false);

  if (format === 'text') {
    return (
      <pre className="text-xs font-mono bg-muted/20 border border-border p-4 rounded-md overflow-auto max-h-[600px] whitespace-pre-wrap">
        {content}
      </pre>
    );
  }

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5 bg-muted/10">
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
          {showSource ? labelSource : labelPreview}
        </span>
        <button
          type="button"
          onClick={() => setShowSource((v) => !v)}
          className={cn(
            'text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded transition-colors border',
            showSource
              ? 'border-accent text-foreground bg-accent/10'
              : 'border-border text-muted-foreground hover:text-foreground',
          )}
        >
          {showSource ? labelPreview : labelSource}
        </button>
      </div>
      <div className="p-4 overflow-auto max-h-[600px]">
        {showSource ? (
          <pre className="text-xs font-mono whitespace-pre-wrap">{content}</pre>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
