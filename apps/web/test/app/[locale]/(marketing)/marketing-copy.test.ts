import { describe, expect, it } from 'vitest';
import en from '../../../../messages/en.json';
import zh from '../../../../messages/zh.json';

function collectMessageValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectMessageValues);
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(collectMessageValues);
  }
  return [];
}

describe('marketing homepage copy', () => {
  it('states plainly what the product does in the hero', () => {
    expect(zh.Marketing.hero.titleLine1).toBe('图片 PDF 文档字体');
    expect(zh.Marketing.hero.titleLine2).toBe('一站处理');
    expect(zh.Common.meta.title).toContain('一站处理');

    expect(en.Marketing.hero.titleLine1).toBe('Images, PDFs, Docs, Fonts');
    expect(en.Marketing.hero.titleLine2).toBe('One Place');
    expect(en.Common.meta.title).toContain('One Place');
  });

  it('describes signed-in capabilities as free beta enhancements', () => {
    expect(zh.Marketing.highlights.free.title).toBe('登录解锁更多');
    expect(en.Marketing.highlights.free.title).toBe('Sign in to unlock more');

    expect(zh.Settings.account.planValues.free).toBe('免费公测（Free Beta）');
    expect(en.Settings.account.planValues.free).toBe('Free beta (Free Beta)');
  });

  it('does not promise a commercial or future payment model in user copy', () => {
    for (const messages of [zh, en]) {
      expect(collectMessageValues(messages).join('\n')).not.toMatch(
        /商业版|付费|commercial|paid/i
      );
    }
  });

  it('uses approachable wording for the lower homepage sections', () => {
    expect(zh.Marketing.tools.heading).toBe('常用工具，即点即用');
    expect(zh.Marketing.highlights.heading).toBe('少一点杂乱，多一点确定性');
    expect(zh.Marketing.cta.heading).toBe('现在就开始处理你的文件');

    expect(en.Marketing.tools.heading).toBe('Popular tools, ready to use');
    expect(en.Marketing.highlights.heading).toBe(
      'Less clutter. More certainty.'
    );
    expect(en.Marketing.cta.heading).toBe(
      'Start working with your files now'
    );
  });
});
