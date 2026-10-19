'use client';

/**
 * 证件照质量检查面板。
 *
 * 常驻在结果区下方、默认展开：用户最需要的是「这张图哪里不合格、该怎么改」，
 * 藏起来等于没有。每一项同时给出实测值与建议，避免只有红点没有信息。
 */

import type { QualityReport } from '@utils-plane/validators';

export function IdPhotoQualityPanel({
  report,
  t,
}: {
  report: QualityReport | null;
  /**
   * 支持变量的翻译函数。next-intl 在缺少 ICU 变量时会回退成 key
   * (`ImageIdPhoto.quality.score`),所以必须把变量传进去,不能拿到文案后
   * 自己 replace 占位符。
   */
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  if (!report) {
    return (
      <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
        {t('quality.unavailable')}
      </div>
    );
  }

  const failedItems = report.items.filter(item => !item.passed);
  const failedNames = failedItems
    .map(item => t(`quality.items.${item.name}`))
    .join(t('quality.listSeparator'));

  const summary = report.passed
    ? t('quality.passed')
    : failedItems.length > 0
      ? t('quality.needsAttention', { items: failedNames })
      : t('quality.unavailable');

  return (
    <details
      open
      className="rounded-md border border-border p-4 text-sm"
      data-testid="id-photo-quality-panel"
    >
      <summary className="flex cursor-pointer items-center justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground">
          {t('quality.title')}
        </span>
        <span className={report.passed ? 'text-emerald-600' : 'text-amber-600'}>
          {summary}
        </span>
      </summary>

      <p className="mt-2 font-mono text-xs text-muted-foreground">
        {t('quality.score', { score: report.score })}
      </p>

      <ul className="mt-3 space-y-2">
        {report.items.map(item => (
          <li
            key={item.name}
            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"
          >
            <span className="flex items-center gap-2">
              <span
                aria-hidden
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  item.passed ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
              />
              {t(`quality.items.${item.name}`)}
            </span>
            <span className="font-mono text-xs tabular-nums">{item.value}</span>
            {!item.passed && (
              <span className="w-full text-xs text-muted-foreground">
                {t(`quality.hints.${item.hint}`)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
