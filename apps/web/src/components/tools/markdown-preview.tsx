'use client';

import {
  isValidElement,
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
  type ReactElement,
  type ReactNode,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { cn } from '@/lib/utils';

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

function getNodeText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(getNodeText).join('');
  if (isValidElement(node)) {
    return getNodeText((node.props as { children?: ReactNode }).children);
  }
  return '';
}

interface CodeBlockProps {
  language: string;
  rawText: string;
  children: ReactNode;
  copyLabel: string;
  copiedLabel: string;
}

function CodeBlock({
  language,
  rawText,
  children,
  copyLabel,
  copiedLabel,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(rawText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div className="my-4 border border-border rounded-md overflow-hidden bg-muted/15">
      <div className="flex items-center justify-between border-b border-border bg-muted/25 px-3 h-7">
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          {language || 'code'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className={cn(
            'text-[10px] font-mono uppercase tracking-wider px-1.5 h-5 rounded transition-colors border',
            copied
              ? 'border-accent text-accent bg-accent/10'
              : 'border-transparent text-muted-foreground/70 hover:text-foreground hover:border-border'
          )}
        >
          {copied ? copiedLabel : copyLabel}
        </button>
      </div>
      <pre className="overflow-auto preview-scroll p-3 m-0 font-mono text-[12.5px] leading-6">
        {children}
      </pre>
    </div>
  );
}

const headingBase = 'font-medium tracking-tight text-foreground scroll-mt-16';

function createComponents(copyLabel: string, copiedLabel: string) {
  return {
    h1: ({ children, ...props }: ComponentPropsWithoutRef<'h1'>) => (
      <h1
        className={cn(
          headingBase,
          'text-2xl mt-8 mb-4 pb-2 border-b border-border first:mt-0'
        )}
        {...props}
      >
        {children}
      </h1>
    ),
    h2: ({ children, ...props }: ComponentPropsWithoutRef<'h2'>) => (
      <h2
        className={cn(
          headingBase,
          'text-xl mt-7 mb-3 pb-1.5 border-b border-border/60 first:mt-0'
        )}
        {...props}
      >
        {children}
      </h2>
    ),
    h3: ({ children, ...props }: ComponentPropsWithoutRef<'h3'>) => (
      <h3
        className={cn(headingBase, 'text-lg mt-6 mb-2 first:mt-0')}
        {...props}
      >
        {children}
      </h3>
    ),
    h4: ({ children, ...props }: ComponentPropsWithoutRef<'h4'>) => (
      <h4
        className={cn(headingBase, 'text-base mt-5 mb-2 first:mt-0')}
        {...props}
      >
        {children}
      </h4>
    ),
    h5: ({ children, ...props }: ComponentPropsWithoutRef<'h5'>) => (
      <h5
        className={cn(headingBase, 'text-sm mt-4 mb-2 first:mt-0')}
        {...props}
      >
        {children}
      </h5>
    ),
    h6: ({ children, ...props }: ComponentPropsWithoutRef<'h6'>) => (
      <h6
        className={cn(
          headingBase,
          'text-xs mt-4 mb-2 uppercase tracking-wider text-muted-foreground first:mt-0'
        )}
        {...props}
      >
        {children}
      </h6>
    ),
    p: ({ children, ...props }: ComponentPropsWithoutRef<'p'>) => (
      <p className="text-sm leading-7 text-foreground/90 my-3" {...props}>
        {children}
      </p>
    ),
    a: ({ children, ...props }: ComponentPropsWithoutRef<'a'>) => (
      <a
        className="text-accent underline decoration-accent/40 underline-offset-[3px] decoration-1 hover:decoration-accent transition-colors"
        target="_blank"
        rel="noopener noreferrer"
        {...props}
      >
        {children}
      </a>
    ),
    ul: ({ children, ...props }: ComponentPropsWithoutRef<'ul'>) => (
      <ul
        className="text-sm leading-7 my-3 pl-5 list-disc marker:text-muted-foreground/60 space-y-1"
        {...props}
      >
        {children}
      </ul>
    ),
    ol: ({ children, ...props }: ComponentPropsWithoutRef<'ol'>) => (
      <ol
        className="text-sm leading-7 my-3 pl-5 list-decimal marker:text-muted-foreground/60 marker:font-mono marker:text-[12px] space-y-1"
        {...props}
      >
        {children}
      </ol>
    ),
    li: ({ children, ...props }: ComponentPropsWithoutRef<'li'>) => (
      <li className="text-foreground/90 [&>p]:my-0" {...props}>
        {children}
      </li>
    ),
    blockquote: ({
      children,
      ...props
    }: ComponentPropsWithoutRef<'blockquote'>) => (
      <blockquote
        className="border-l-2 border-accent pl-4 my-4 text-muted-foreground [&>p]:my-1.5"
        {...props}
      >
        {children}
      </blockquote>
    ),
    hr: (props: ComponentPropsWithoutRef<'hr'>) => (
      <hr className="my-6 border-0 border-t border-border" {...props} />
    ),
    strong: ({ children, ...props }: ComponentPropsWithoutRef<'strong'>) => (
      <strong className="font-semibold text-foreground" {...props}>
        {children}
      </strong>
    ),
    em: ({ children, ...props }: ComponentPropsWithoutRef<'em'>) => (
      <em className="italic text-foreground/90" {...props}>
        {children}
      </em>
    ),
    code: ({
      children,
      className,
      ...props
    }: ComponentPropsWithoutRef<'code'>) => {
      const isBlock = /\blanguage-/.test(className ?? '');
      if (isBlock) {
        return (
          <code className={cn('hljs', className)} {...props}>
            {children}
          </code>
        );
      }
      return (
        <code
          className="bg-muted/40 border border-border/60 px-1.5 py-[1px] rounded text-[12px] font-mono text-foreground"
          {...props}
        >
          {children}
        </code>
      );
    },
    pre: ({ children }: ComponentPropsWithoutRef<'pre'>) => {
      const child = Array.isArray(children) ? children[0] : children;
      let language = '';
      if (isValidElement(child)) {
        const childProps = (child as ReactElement<{ className?: string }>)
          .props;
        const match = /language-(\w+)/.exec(childProps.className ?? '');
        if (match) language = match[1] ?? '';
      }
      const rawText = getNodeText(children).replace(/\n$/, '');
      return (
        <CodeBlock
          language={language}
          rawText={rawText}
          copyLabel={copyLabel}
          copiedLabel={copiedLabel}
        >
          {children}
        </CodeBlock>
      );
    },
    table: ({ children, ...props }: ComponentPropsWithoutRef<'table'>) => (
      <div className="my-4 overflow-x-auto border border-border rounded-md">
        <table className="w-full text-sm border-collapse" {...props}>
          {children}
        </table>
      </div>
    ),
    thead: ({ children, ...props }: ComponentPropsWithoutRef<'thead'>) => (
      <thead className="bg-muted/20" {...props}>
        {children}
      </thead>
    ),
    th: ({ children, ...props }: ComponentPropsWithoutRef<'th'>) => (
      <th
        className="text-left text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground px-3 py-2 border-b border-border"
        {...props}
      >
        {children}
      </th>
    ),
    td: ({ children, ...props }: ComponentPropsWithoutRef<'td'>) => (
      <td
        className="px-3 py-2 border-b border-border/40 text-foreground/90"
        {...props}
      >
        {children}
      </td>
    ),
    tr: ({ children, ...props }: ComponentPropsWithoutRef<'tr'>) => (
      <tr className="hover:bg-muted/15 transition-colors" {...props}>
        {children}
      </tr>
    ),
    img: ({ alt, ...props }: ComponentPropsWithoutRef<'img'>) => (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt={alt ?? ''}
        className="max-w-full h-auto my-4 border border-border rounded-md"
        {...props}
      />
    ),
  };
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
  const components = useMemo(
    () => createComponents(labelCopy, labelCopied),
    [labelCopy, labelCopied]
  );
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
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[
                  [rehypeHighlight, { detect: true, ignoreMissing: true }],
                ]}
                components={components as never}
              >
                {content}
              </ReactMarkdown>
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
