import { describe, expect, it } from 'bun:test';
import { sanitizeImageError } from './image-error-sanitizer';

describe('sanitizeImageError', () => {
  it('extracts the message field from an OpenAI-style error body', () => {
    expect(
      sanitizeImageError(
        JSON.stringify({
          error: { message: 'quota exceeded', type: 'insufficient_quota' },
        })
      )
    ).toBe('quota exceeded');
  });

  it('extracts flattened message variants from gateway bodies', () => {
    expect(sanitizeImageError('{"message":"upstream timeout"}')).toBe(
      'upstream timeout'
    );
    expect(sanitizeImageError('{"error_msg":"bad model"}')).toBe('bad model');
    expect(sanitizeImageError('{"error":{"code":400,"msg":"nope"}}')).toBe(
      'nope'
    );
  });

  it('falls back to truncated raw text when the body has no message field', () => {
    expect(sanitizeImageError('{"error":{"code":503}}')).toBe(
      '{"error":{"code":503}}'
    );
  });

  it('keeps plain-text errors on a single line', () => {
    expect(sanitizeImageError('line one\n  line two\t\rend')).toBe(
      'line one line two end'
    );
  });

  it('redacts declared secrets case-insensitively', () => {
    const prompt = '一只戴礼帽的柴犬在冲浪';
    const body = JSON.stringify({
      error: { message: `Your prompt "${prompt}" was rejected` },
    });
    const result = sanitizeImageError(body, [prompt]);
    expect(result).not.toContain(prompt);
    expect(result).toContain('[redacted]');
    expect(result).toContain('was rejected');
  });

  it('redacts api key shapes and bearer tokens', () => {
    const result = sanitizeImageError(
      'auth failed with sk-abcdef1234567890 and Bearer ghp_1234567890abcdefghij'
    );
    expect(result).not.toContain('sk-abcdef1234567890');
    expect(result).not.toContain('ghp_1234567890');
    expect(result).toContain('[redacted]');
  });

  it('reduces urls to their host', () => {
    expect(
      sanitizeImageError(
        'download https://files.example.com/private/x.png?sig=secret123 failed'
      )
    ).toBe('download files.example.com failed');
  });

  it('truncates overly long messages', () => {
    const result = sanitizeImageError(`E`.padEnd(1000, 'x'));
    expect(result.length).toBeLessThanOrEqual(280);
    expect(result.endsWith('…')).toBe(true);
  });

  it('accepts Error instances and returns empty for empty input', () => {
    expect(sanitizeImageError(new Error('boom'))).toBe('boom');
    expect(sanitizeImageError('')).toBe('');
    expect(sanitizeImageError('   \n  ')).toBe('');
  });

  it('handles non-string values without throwing', () => {
    expect(sanitizeImageError({ status: 500 })).toContain('500');
    expect(sanitizeImageError(undefined)).toBe('undefined');
  });
});
