import { describe, expect, it } from 'bun:test';
import {
  idPhotoTaskConfigSchema,
  idPhotoPresetEnum,
  normalizeHexColor,
  idPhotoCropFromBox,
  idPhotoCropSchema,
  resolveIdPhotoCropBox,
} from './id-photo';

describe('id photo validators', () => {
  it('accepts a valid one inch task config', () => {
    const result = idPhotoTaskConfigSchema.parse({
      preset: 'one_inch',
      backgroundColor: '#438edb',
      outputType: 'image/jpeg',
      dpi: 300,
      crop: { x: 0.5, y: 0.48, scale: 1.1 },
    });

    expect(result.preset).toBe('one_inch');
    expect(result.backgroundColor).toBe('#438edb');
    expect(result.segmentationMode).toBe('local');
  });

  it('accepts ai segmentation mode', () => {
    const result = idPhotoTaskConfigSchema.parse({
      preset: 'one_inch',
      backgroundColor: '#438edb',
      outputType: 'image/jpeg',
      dpi: 300,
      segmentationMode: 'ai',
    });

    expect(result.segmentationMode).toBe('ai');
  });

  it('rejects invalid preset values', () => {
    expect(() => idPhotoPresetEnum.parse('visa_us')).toThrow();
  });

  it('normalizes uppercase hex colors', () => {
    expect(normalizeHexColor('#FF0000')).toBe('#ff0000');
  });

  it('rejects non-hex background colors', () => {
    expect(() =>
      idPhotoTaskConfigSchema.parse({
        preset: 'passport',
        backgroundColor: 'blue',
        outputType: 'image/png',
        dpi: 300,
      })
    ).toThrow();
  });

  it('rejects crop scale outside the supported range', () => {
    expect(() =>
      idPhotoTaskConfigSchema.parse({
        preset: 'passport',
        backgroundColor: '#ffffff',
        outputType: 'image/jpeg',
        dpi: 300,
        crop: { x: 0.5, y: 0.5, scale: 4 },
      })
    ).toThrow();
  });
});

describe('resolveIdPhotoCropBox', () => {
  it('默认参数等价于居中裁剪(与历史行为一致)', () => {
    // 源图比目标更宽:高度吃满,宽度按比例居中收窄。
    expect(resolveIdPhotoCropBox(800, 600, 295, 413)).toEqual({
      left: Math.round((800 - 600 * (295 / 413)) / 2),
      top: 0,
      width: Math.round(600 * (295 / 413)),
      height: 600,
    });
  });

  it('源图比目标更窄时宽度吃满', () => {
    const box = resolveIdPhotoCropBox(295, 900, 295, 413);
    expect(box.width).toBe(295);
    expect(box.left).toBe(0);
    expect(box.height).toBe(Math.round(295 / (295 / 413)));
  });

  it('裁剪框始终保持目标宽高比', () => {
    const target = 295 / 413;
    for (const [w, h] of [
      [800, 600],
      [600, 800],
      [1000, 1000],
      [413, 295],
    ]) {
      const box = resolveIdPhotoCropBox(w!, h!, 295, 413);
      expect(box.width / box.height).toBeCloseTo(target, 1);
    }
  });

  it('scale 放大画面即缩小裁剪框', () => {
    const base = resolveIdPhotoCropBox(800, 600, 295, 413);
    const zoomed = resolveIdPhotoCropBox(800, 600, 295, 413, {
      x: 0.5,
      y: 0.5,
      scale: 2,
    });
    // 实现是从未取整的基准框整除后再取整,与「先取整再除」可能差 1px,这里允许。
    expect(zoomed.width).toBeCloseTo(base.width / 2, -0.5);
    expect(zoomed.height).toBeCloseTo(base.height / 2, -0.5);
    expect(zoomed.width).toBeLessThan(base.width);
  });

  it('x/y 移动裁剪框中心', () => {
    const centered = resolveIdPhotoCropBox(800, 600, 295, 413, {
      x: 0.5,
      y: 0.5,
      scale: 2,
    });
    const moved = resolveIdPhotoCropBox(800, 600, 295, 413, {
      x: 0.3,
      y: 0.5,
      scale: 2,
    });
    expect(moved.left).toBeLessThan(centered.left);
  });

  it('裁剪框被夹在源图范围内,不会让 extract 越界', () => {
    for (const crop of [
      { x: 0, y: 0, scale: 1 },
      { x: 1, y: 1, scale: 1 },
      { x: 0, y: 1, scale: 3 },
      { x: 1, y: 0, scale: 3 },
    ]) {
      const box = resolveIdPhotoCropBox(800, 600, 295, 413, crop);
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.left + box.width).toBeLessThanOrEqual(800);
      expect(box.top + box.height).toBeLessThanOrEqual(600);
    }
  });

  it('scale 小于 1 会被夹回 1,避免裁剪框超出源图', () => {
    const box = resolveIdPhotoCropBox(800, 600, 295, 413, {
      x: 0.5,
      y: 0.5,
      scale: 0.5,
    });
    expect(box).toEqual(resolveIdPhotoCropBox(800, 600, 295, 413));
  });

  it('schema 拒绝小于 1 的 scale', () => {
    expect(() =>
      idPhotoTaskConfigSchema.parse({
        preset: 'one_inch',
        backgroundColor: '#ffffff',
        outputType: 'image/jpeg',
        dpi: 300,
        crop: { x: 0.5, y: 0.5, scale: 0.9 },
      })
    ).toThrow();
  });
});

describe('idPhotoCropFromBox', () => {
  const W = 1000;
  const H = 1500;
  const TW = 295;
  const TH = 413;

  it('是 resolveIdPhotoCropBox 的逆运算', () => {
    for (const crop of [
      { x: 0.5, y: 0.5, scale: 1 },
      { x: 0.35, y: 0.4, scale: 1.6 },
      { x: 0.7, y: 0.65, scale: 2.4 },
    ]) {
      const box = resolveIdPhotoCropBox(W, H, TW, TH, crop);
      const back = idPhotoCropFromBox(W, H, TW, TH, box);
      const again = resolveIdPhotoCropBox(W, H, TW, TH, back);

      // 往返后必须落回同一个框(允许取整带来的 1px 误差)
      expect(Math.abs(again.left - box.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(again.top - box.top)).toBeLessThanOrEqual(1);
      expect(Math.abs(again.width - box.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(again.height - box.height)).toBeLessThanOrEqual(1);
    }
  });

  it('产出的 crop 始终通过 schema 校验', () => {
    const box = resolveIdPhotoCropBox(W, H, TW, TH, {
      x: 0.1,
      y: 0.9,
      scale: 3,
    });
    const crop = idPhotoCropFromBox(W, H, TW, TH, box);

    expect(() => idPhotoCropSchema.parse(crop)).not.toThrow();
  });

  it('整框对应 scale=1', () => {
    const box = resolveIdPhotoCropBox(W, H, TW, TH);
    expect(idPhotoCropFromBox(W, H, TW, TH, box).scale).toBeCloseTo(1, 1);
  });
});
