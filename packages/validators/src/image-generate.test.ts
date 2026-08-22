import { describe, expect, it } from 'bun:test';
import { imageGenerateTaskConfigSchema } from './image-generate';

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

  it('rejects a prompt longer than 2000 characters', () => {
    expect(() =>
      imageGenerateTaskConfigSchema.parse({
        ...base,
        prompt: 'a'.repeat(2001),
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
});
