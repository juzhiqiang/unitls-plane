type UnitKey = 'b' | 'kb' | 'mb' | 'gb';
type UnitTranslator = (key: UnitKey) => string;

/**
 * Format a byte count to a human-readable string, with locale-aware decimals and
 * translated unit labels. Pass a `t` function bound to the `Common.units` namespace.
 */
export function formatBytes(
  bytes: number,
  t: UnitTranslator,
  locale?: string,
): string {
  const fmt = (n: number, fractionDigits: number) =>
    new Intl.NumberFormat(locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: fractionDigits,
    }).format(n);

  if (bytes < 1024) return `${fmt(bytes, 0)} ${t('b')}`;
  if (bytes < 1024 * 1024) return `${fmt(bytes / 1024, 1)} ${t('kb')}`;
  if (bytes < 1024 * 1024 * 1024)
    return `${fmt(bytes / (1024 * 1024), 2)} ${t('mb')}`;
  return `${fmt(bytes / (1024 * 1024 * 1024), 2)} ${t('gb')}`;
}
