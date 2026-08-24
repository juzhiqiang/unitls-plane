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

    expect(parsed.size).toBe('1024x1024');
    expect(parsed.quality).toBe('high');
    expect(parsed.style).toBeUndefined();
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

  it('requires exactly one input file for image_to_image', () => {
    expect(() =>
      imageGenerateTaskConfigSchema.parse({
        mode: 'image_to_image',
        prompt: 'x',
        inputFileCount: 0,
      })
    ).toThrow('image_to_image');
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
