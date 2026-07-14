import { describe, expect, it } from 'vitest';
import en from '../../../../../messages/en.json';
import zh from '../../../../../messages/zh.json';

function collectMessageValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectMessageValues);
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(collectMessageValues);
  }
  return [];
}

describe('marketing homepage copy', () => {
  it('positions the homepage around the processing engine narrative', () => {
    expect(zh.Marketing.hero.titleLine1).toBe('文件开始进化');
    expect(zh.Marketing.hero.titleLine2).toBe('同一处理核心');
    expect(zh.Common.meta.title).toContain('文件进化处理核心');

    expect(en.Marketing.hero.titleLine1).toBe('Files Evolve');
    expect(en.Marketing.hero.titleLine2).toBe('In One Core');
    expect(en.Common.meta.title).toContain('File Evolution Core');
  });

  it('describes signed-in capabilities as free beta enhancements', () => {
    expect(zh.Marketing.highlights.free.title).toBe('登录增强能力');
    expect(en.Marketing.highlights.free.title).toBe(
      'Signed-in enhanced capabilities'
    );

    expect(zh.Settings.account.planValues.free).toBe('免费公测');
    expect(en.Settings.account.planValues.free).toBe('Free beta');
  });

  it('does not promise a commercial or future payment model in user copy', () => {
    for (const messages of [zh, en]) {
      expect(collectMessageValues(messages).join('\n')).not.toMatch(
        /商业版|付费|commercial|paid/i
      );
    }
  });

  it('uses product-page wording for the lower homepage sections', () => {
    expect(zh.Marketing.tools.heading).toBe('像产品一样组织处理能力');
    expect(zh.Marketing.highlights.heading).toBe('少一点杂乱，多一点确定性');
    expect(zh.Marketing.cta.heading).toBe('准备好让文件进入下一段工作流');

    expect(en.Marketing.tools.heading).toBe(
      'Processing, arranged like products'
    );
    expect(en.Marketing.highlights.heading).toBe(
      'Less clutter. More certainty.'
    );
    expect(en.Marketing.cta.heading).toBe('Ready for the next file workflow');
  });
});
