import { describe, expect, it, vi } from 'vitest';
import { formatBytes } from '@/lib/format';

type UnitKey = 'b' | 'kb' | 'mb' | 'gb';

function makeT() {
  return vi.fn((key: UnitKey) => key.toUpperCase());
}

describe('formatBytes', () => {
  it('formats bytes under 1 KiB with the B unit and no decimals', () => {
    const t = makeT();
    expect(formatBytes(500, t, 'en-US')).toBe('500 B');
    expect(t).toHaveBeenCalledWith('b');
  });

  it('formats kilobytes with one decimal digit and the KB unit', () => {
    const t = makeT();
    // 1500 / 1024 = 1.46484... -> "1.5 KB"
    expect(formatBytes(1500, t, 'en-US')).toBe('1.5 KB');
    expect(t).toHaveBeenCalledWith('kb');
  });

  it('formats megabytes with up to two decimal digits and the MB unit', () => {
    const t = makeT();
    // 1_500_000 / (1024*1024) = 1.43051... -> "1.43 MB"
    expect(formatBytes(1_500_000, t, 'en-US')).toBe('1.43 MB');
    expect(t).toHaveBeenCalledWith('mb');
  });

  it('formats gigabytes with up to two decimal digits and the GB unit', () => {
    const t = makeT();
    // 1_500_000_000 / (1024^3) = 1.39698... -> "1.4 GB"
    expect(formatBytes(1_500_000_000, t, 'en-US')).toBe('1.4 GB');
    expect(t).toHaveBeenCalledWith('gb');
  });

  it('produces the same output for en-US and zh-CN for small numbers (no thousand separators)', () => {
    const tEn = makeT();
    const tZh = makeT();
    expect(formatBytes(500, tEn, 'en-US')).toBe(formatBytes(500, tZh, 'zh-CN'));
    expect(formatBytes(1500, tEn, 'en-US')).toBe(
      formatBytes(1500, tZh, 'zh-CN'),
    );
    expect(formatBytes(1_500_000, tEn, 'en-US')).toBe(
      formatBytes(1_500_000, tZh, 'zh-CN'),
    );
    expect(formatBytes(1_500_000_000, tEn, 'en-US')).toBe(
      formatBytes(1_500_000_000, tZh, 'zh-CN'),
    );
  });

  it('works without an explicit locale', () => {
    const t = makeT();
    expect(formatBytes(500, t)).toMatch(/500\s+B/);
  });
});
