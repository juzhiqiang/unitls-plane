import { describe, expect, it } from 'bun:test';
import {
  idPhotoTaskConfigSchema,
  idPhotoPresetEnum,
  normalizeHexColor,
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
