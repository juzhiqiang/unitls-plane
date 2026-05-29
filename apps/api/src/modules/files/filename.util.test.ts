import { describe, expect, it } from 'bun:test';
import { normalizeUploadedFilename } from './filename.util';

describe('normalizeUploadedFilename', () => {
  it('keeps an already readable filename unchanged', () => {
    expect(normalizeUploadedFilename('report.pdf')).toBe('report.pdf');
    expect(normalizeUploadedFilename('中文文件.pdf')).toBe('中文文件.pdf');
  });

  it('repairs filenames that were decoded as latin1 instead of UTF-8', () => {
    const mojibake = Buffer.from('中文文件.pdf', 'utf8').toString('latin1');

    expect(normalizeUploadedFilename(mojibake)).toBe('中文文件.pdf');
  });
});
