import { describe, expect, it } from 'vitest';
import {
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
