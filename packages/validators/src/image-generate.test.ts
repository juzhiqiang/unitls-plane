import { describe, expect, it } from 'bun:test';
import {
  IMAGE_GENERATE_PROMPT_MAX_LENGTH,
  imageGenerateTaskConfigSchema,
} from './image-generate';

const base = {
  mode: 'text_to_image' as const,
  prompt: '一只戴礼帽的柴犬',
};

describe('imageGenerateTaskConfigSchema', () => {
  it('applies defaults for size and quality', () => {
    const parsed = imageGenerateTaskConfigSchema.parse({
      ...base,
      inputFileCount: 0,
    });

    // 默认尺寸是具体档位而非 "auto":"auto" 只是 gpt-image-1 一族的语义,
    // 漏发 size 的客户端不该默认拿到一个大多数网关不认的值。
    expect(parsed.size).toBe('1024x1024');
    expect(parsed.quality).toBe('high');
    expect(parsed.style).toBeUndefined();
    expect(parsed.background).toBeUndefined();
    expect(parsed.sessionId).toBeUndefined();
    expect(parsed.clientGroupId).toBeUndefined();
  });

  it('accepts concrete WxH sizes and auto', () => {
    for (const size of ['1024x1024', '1024x1536', '1536x1024', 'auto']) {
      const parsed = imageGenerateTaskConfigSchema.parse({
        ...base,
        size,
        inputFileCount: 0,
      });

      expect(parsed.size).toBe(size);
    }
  });

  it('rejects malformed sizes', () => {
    for (const size of [
      'square',
      '1024',
      '1024x',
      'x1024',
      'ax1024',
      '1024x1024x768',
      '',
    ]) {
      expect(
        imageGenerateTaskConfigSchema.safeParse({
          ...base,
          size,
          inputFileCount: 0,
        }).success
      ).toBe(false);
    }
  });

  it('accepts the auto quality', () => {
    const parsed = imageGenerateTaskConfigSchema.parse({
      ...base,
      quality: 'auto',
      inputFileCount: 0,
    });

    expect(parsed.quality).toBe('auto');
  });

  it('accepts a transparent background and rejects unknown values', () => {
    const parsed = imageGenerateTaskConfigSchema.parse({
      ...base,
      background: 'transparent',
      inputFileCount: 0,
    });

    expect(parsed.background).toBe('transparent');

    expect(
      imageGenerateTaskConfigSchema.safeParse({
        ...base,
        background: 'gradient',
        inputFileCount: 0,
      }).success
    ).toBe(false);
  });

  it('accepts uuid session and client group ids and rejects other shapes', () => {
    const sessionId = '0f0d7ac5-4d3a-4a9e-9a75-2f76db11a001';
    const clientGroupId = '0f0d7ac5-4d3a-4a9e-9a75-2f76db11a002';

    const parsed = imageGenerateTaskConfigSchema.parse({
      ...base,
      sessionId,
      clientGroupId,
      inputFileCount: 0,
    });

    expect(parsed.sessionId).toBe(sessionId);
    expect(parsed.clientGroupId).toBe(clientGroupId);

    expect(
      imageGenerateTaskConfigSchema.safeParse({
        ...base,
        sessionId: 'not-a-uuid',
        inputFileCount: 0,
      }).success
    ).toBe(false);
  });

  it('rejects an empty prompt', () => {
    expect(() =>
      imageGenerateTaskConfigSchema.parse({
        ...base,
        prompt: '   ',
        inputFileCount: 0,
      })
    ).toThrow();
  });

  // 产品决定：提示词上限 5000 字。这里钉住数值本身,
  // 其余断言一律从常量推导,改上限时只需要动这一处期望。
  it('caps the prompt at 5000 characters', () => {
    expect(IMAGE_GENERATE_PROMPT_MAX_LENGTH).toBe(5000);
  });

  it('accepts a prompt exactly at the length limit', () => {
    const parsed = imageGenerateTaskConfigSchema.parse({
      ...base,
      prompt: 'a'.repeat(IMAGE_GENERATE_PROMPT_MAX_LENGTH),
      inputFileCount: 0,
    });

    expect(parsed.prompt).toHaveLength(IMAGE_GENERATE_PROMPT_MAX_LENGTH);
  });

  it('rejects a prompt one character over the limit', () => {
    expect(() =>
      imageGenerateTaskConfigSchema.parse({
        ...base,
        prompt: 'a'.repeat(IMAGE_GENERATE_PROMPT_MAX_LENGTH + 1),
        inputFileCount: 0,
      })
    ).toThrow();
  });

  it('requires zero input files for text_to_image', () => {
    expect(() =>
      imageGenerateTaskConfigSchema.parse({ ...base, inputFileCount: 1 })
    ).toThrow('text_to_image');
  });

  it('accepts 1 to 4 input files for image_to_image fusion', () => {
    for (const inputFileCount of [1, 2, 3, 4]) {
      const parsed = imageGenerateTaskConfigSchema.parse({
        mode: 'image_to_image',
        prompt: 'x',
        inputFileCount,
      });

      expect(parsed.inputFileCount).toBe(inputFileCount);
    }

    // 0 张(没附图)与 5 张(超融合上限)都拒绝。
    expect(() =>
      imageGenerateTaskConfigSchema.parse({
        mode: 'image_to_image',
        prompt: 'x',
        inputFileCount: 0,
      })
    ).toThrow('image_to_image');
    expect(() =>
      imageGenerateTaskConfigSchema.parse({
        mode: 'image_to_image',
        prompt: 'x',
        inputFileCount: 5,
      })
    ).toThrow('1-4');
  });

  it('accepts 2 to 3 input files for inpaint', () => {
    for (const inputFileCount of [2, 3]) {
      const parsed = imageGenerateTaskConfigSchema.parse({
        mode: 'inpaint',
        prompt: 'x',
        inputFileCount,
      });

      expect(parsed.inputFileCount).toBe(inputFileCount);
    }

    expect(() =>
      imageGenerateTaskConfigSchema.parse({
        mode: 'inpaint',
        prompt: 'x',
        inputFileCount: 1,
      })
    ).toThrow('inpaint');
    expect(() =>
      imageGenerateTaskConfigSchema.parse({
        mode: 'inpaint',
        prompt: 'x',
        inputFileCount: 4,
      })
    ).toThrow('2-3');
  });

  it('requires exactly two input files for inpaint', () => {
    expect(() =>
      imageGenerateTaskConfigSchema.parse({
        mode: 'inpaint',
        prompt: 'x',
        inputFileCount: 1,
      })
    ).toThrow('inpaint');
  });

  it('accepts exactly one input file for image_to_image', () => {
    const parsed = imageGenerateTaskConfigSchema.parse({
      mode: 'image_to_image',
      prompt: '把背景换成海边',
      inputFileCount: 1,
    });

    expect(parsed.mode).toBe('image_to_image');
    expect(parsed.inputFileCount).toBe(1);
  });

  it('accepts exactly two input files for inpaint', () => {
    const parsed = imageGenerateTaskConfigSchema.parse({
      mode: 'inpaint',
      prompt: '擦掉画面里的路人',
      inputFileCount: 2,
    });

    expect(parsed.mode).toBe('inpaint');
    expect(parsed.inputFileCount).toBe(2);
  });

  it('accepts a supported style', () => {
    const parsed = imageGenerateTaskConfigSchema.parse({
      ...base,
      style: 'anime',
      inputFileCount: 0,
    });

    expect(parsed.style).toBe('anime');
  });

  it('accepts a provider id and leaves it untouched', () => {
    const parsed = imageGenerateTaskConfigSchema.parse({
      ...base,
      providerId: 'kmage',
      inputFileCount: 0,
    });

    expect(parsed.providerId).toBe('kmage');
  });

  it('leaves providerId undefined when it is omitted', () => {
    const parsed = imageGenerateTaskConfigSchema.parse({
      ...base,
      inputFileCount: 0,
    });

    expect(parsed.providerId).toBeUndefined();
  });

  it('rejects a provider id with characters that could smuggle a path', () => {
    for (const providerId of ['../etc', 'a b', '-lead', 'x'.repeat(65), '']) {
      expect(
        imageGenerateTaskConfigSchema.safeParse({
          ...base,
          providerId,
          inputFileCount: 0,
        }).success
      ).toBe(false);
    }
  });
});
