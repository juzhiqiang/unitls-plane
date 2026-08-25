import { describe, expect, it } from 'bun:test';
import {
  buildContentDisposition,
  resolveContentDispositionType,
} from './content-disposition.util';

describe('buildContentDisposition', () => {
  it('defaults to attachment and keeps the ASCII filename', () => {
    expect(buildContentDisposition('report.pdf')).toBe(
      'attachment; filename="report.pdf"; filename*=UTF-8\'\'report.pdf'
    );
  });

  it('supports inline previews', () => {
    expect(buildContentDisposition('avatar.png', 'inline')).toBe(
      'inline; filename="avatar.png"; filename*=UTF-8\'\'avatar.png'
    );
  });

  it('provides an ASCII fallback plus UTF-8 name for CJK filenames', () => {
    const header = buildContentDisposition('发票.pdf', 'attachment');

    expect(header).toBe(
      'attachment; filename="__.pdf"; filename*=UTF-8\'\'%E5%8F%91%E7%A5%A8.pdf'
    );
  });

  it('escapes quotes, path separators and RFC 5987 special characters', () => {
    const header = buildContentDisposition('a/b/na"me (1).png');

    expect(header).toBe(
      'attachment; filename="na_me (1).png"; filename*=UTF-8\'\'na%22me%20%281%29.png'
    );
  });

  it('falls back to a generic name when the filename is empty', () => {
    expect(buildContentDisposition('   ')).toBe(
      'attachment; filename="file"; filename*=UTF-8\'\'file'
    );
  });
});

describe('resolveContentDispositionType', () => {
  it('treats truthy query values as attachment', () => {
    for (const value of ['1', 'true', 'TRUE', ' yes ', 'attachment']) {
      expect(resolveContentDispositionType(value)).toBe('attachment');
    }
  });

  it('keeps inline for missing or falsy query values', () => {
    for (const value of [undefined, null, '', '0', 'false', 'inline', 2]) {
      expect(resolveContentDispositionType(value)).toBe('inline');
    }
  });
});
