import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import zh from '../../messages/zh.json';

function flattenKeys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [prefix];
  }

  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, child]) => flattenKeys(child, prefix ? `${prefix}.${key}` : key)
  );
}

describe('message catalogues', () => {
  const zhKeys = flattenKeys(zh).sort();
  const enKeys = flattenKeys(en).sort();

  it('keeps zh and en in structural parity', () => {
    expect(zhKeys).toEqual(enKeys);
  });

  it('carries the AI image generation namespace in both locales', () => {
    for (const keys of [zhKeys, enKeys]) {
      expect(keys).toContain('ImageGenerate.promptLabel');
      expect(keys).toContain('ImageGenerate.quotaExceeded');
      expect(keys).toContain('ToolCatalog.tools.imageGenerate.title');
      expect(keys).toContain('ToolCatalog.categories.imageGenerate');
      expect(keys).toContain('ToolCatalog.categories.imageGenerateDescription');
      expect(keys).toContain('TasksTool.typeImageGenerate');
      expect(keys).toContain('Dashboard.taskTypes.image_generate');
    }
  });
});
