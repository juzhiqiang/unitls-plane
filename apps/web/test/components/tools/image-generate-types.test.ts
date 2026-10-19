import { describe, expect, it } from 'vitest';
import {
  resolveCustomRatio,
  resolveDraftSize,
  sizeToRatioLabel,
  stripInpaintPromptPrefix,
} from '@/components/tools/image-generate/types';

describe('image-generate types & size resolution', () => {
  const modelSizes = [
    '1024x1024',
    '1024x1536',
    '1536x1024',
    '864x1152',
    '1152x864',
    '864x1536',
    '1536x864',
  ];

  it('keeps exact match when size is directly in modelSizes', () => {
    expect(resolveDraftSize('1536x864', modelSizes)).toBe('1536x864');
    expect(resolveDraftSize('1024x1024', modelSizes)).toBe('1024x1024');
    expect(resolveDraftSize('864x1536', modelSizes)).toBe('864x1536');
  });

  it('resolves 16:9 upstream resolutions to 1536x864 instead of falling back to 1024x1024', () => {
    // DALL-E 3 16:9
    expect(resolveDraftSize('1792x1024', modelSizes)).toBe('1536x864');
    // Flux / SDXL 16:9
    expect(resolveDraftSize('1344x768', modelSizes)).toBe('1536x864');
    // Standard 720p 16:9
    expect(resolveDraftSize('1280x720', modelSizes)).toBe('1536x864');
    // Standard 1080p 16:9
    expect(resolveDraftSize('1920x1080', modelSizes)).toBe('1536x864');
  });

  it('resolves 9:16 upstream resolutions to 864x1536', () => {
    // DALL-E 3 9:16
    expect(resolveDraftSize('1024x1792', modelSizes)).toBe('864x1536');
    // Flux / SDXL 9:16
    expect(resolveDraftSize('768x1344', modelSizes)).toBe('864x1536');
    // 720p portrait
    expect(resolveDraftSize('720x1280', modelSizes)).toBe('864x1536');
  });

  it('resolves 3:4 and 4:3 upstream resolutions to matching aspect ratio sizes', () => {
    // 3:4
    expect(resolveDraftSize('768x1024', modelSizes)).toBe('864x1152');
    // 4:3
    expect(resolveDraftSize('1024x768', modelSizes)).toBe('1152x864');
  });

  it('resolves 2:3 and 3:2 upstream resolutions to matching aspect ratio sizes', () => {
    // 2:3
    expect(resolveDraftSize('832x1216', modelSizes)).toBe('1024x1536');
    // 3:2
    expect(resolveDraftSize('1216x832', modelSizes)).toBe('1536x1024');
  });

  it('resolves non-standard square resolutions to 1024x1024', () => {
    expect(resolveDraftSize('512x512', modelSizes)).toBe('1024x1024');
    expect(resolveDraftSize('768x768', modelSizes)).toBe('1024x1024');
  });

  it('handles "auto" properly', () => {
    // When "auto" is in modelSizes
    expect(resolveDraftSize('auto', ['auto', '1024x1024'])).toBe('auto');
    // When "auto" is not in modelSizes, falls back to first option
    expect(resolveDraftSize('auto', modelSizes)).toBe('1024x1024');
  });

  it('handles empty or undefined modelSizes by returning the requested size', () => {
    expect(resolveDraftSize('1792x1024', undefined)).toBe('1792x1024');
    expect(resolveDraftSize('1792x1024', [])).toBe('1792x1024');
  });
});

describe('resolveCustomRatio', () => {
  const modelSizes = [
    'auto',
    '1024x1024',
    '1024x1536',
    '1536x1024',
    '864x1152',
    '1152x864',
    '864x1536',
    '1536x864',
  ];

  it('maps a ratio that matches a declared chip to that chip size', () => {
    expect(resolveCustomRatio('16:9', modelSizes)).toBe('1536x864');
    expect(resolveCustomRatio('9:16', modelSizes)).toBe('864x1536');
    expect(resolveCustomRatio(' 4:3 ', modelSizes)).toBe('1152x864');
    // 未约分也按比例比对:32:18 与 16:9 等价。
    expect(resolveCustomRatio('32:18', modelSizes)).toBe('1536x864');
  });

  it('synthesizes a size for a ratio with no matching chip', () => {
    // 长边 1536,短边 1536 × 9/21 = 658.3 → 取整到 16 的倍数 = 656。
    expect(resolveCustomRatio('21:9', modelSizes)).toBe('1536x656');
    // 竖向比例保持短边在前。
    expect(resolveCustomRatio('9:21', modelSizes)).toBe('656x1536');
    // 1:1 有档位时走档位;没有档位时合成 1536x1536。
    expect(resolveCustomRatio('1:1', ['1024x1024'])).toBe('1024x1024');
    expect(resolveCustomRatio('1:1', [])).toBe('1536x1536');
  });

  it('passes an explicit WxH size through untouched', () => {
    expect(resolveCustomRatio('1920x824', modelSizes)).toBe('1920x824');
    // 大小写 X 也接受。
    expect(resolveCustomRatio('1920X824', modelSizes)).toBe('1920x824');
    // 碰巧等比某档位也原样直传,不做换算。
    expect(resolveCustomRatio('1536x864', modelSizes)).toBe('1536x864');
  });

  it('rejects malformed or out-of-range input', () => {
    expect(resolveCustomRatio('', modelSizes)).toBeNull();
    expect(resolveCustomRatio('wide', modelSizes)).toBeNull();
    expect(resolveCustomRatio('16', modelSizes)).toBeNull();
    expect(resolveCustomRatio('16:', modelSizes)).toBeNull();
    expect(resolveCustomRatio('0:9', modelSizes)).toBeNull();
    expect(resolveCustomRatio('99999:9', modelSizes)).toBeNull();
    // 尺寸两侧各限 16–4096,且至少一边 ≥ 64。
    expect(resolveCustomRatio('1x1', modelSizes)).toBeNull();
    expect(resolveCustomRatio('8x32', modelSizes)).toBeNull();
    expect(resolveCustomRatio('5000x1024', modelSizes)).toBeNull();
  });
});
