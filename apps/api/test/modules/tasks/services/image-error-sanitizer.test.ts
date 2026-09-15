import { describe, expect, it } from 'bun:test';
import { sanitizeImageError } from '../../../../src/modules/tasks/services/image-error-sanitizer';

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

  /** 有的网关把 error 直接写成字符串,这本身就是给用户的原因。 */
  it('extracts a string error field', () => {
    expect(
      sanitizeImageError(
        '{"error":"抱歉，我不能帮助生成裸体或露骨色情内容的图片。"}'
      )
    ).toBe('抱歉，我不能帮助生成裸体或露骨色情内容的图片。');
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
    expect(result.length).toBeLessThanOrEqual(160);
    expect(result.endsWith('…')).toBe(true);
  });

  it('reduces an html gateway page to its title without the status prefix', () => {
    // 外层消息已经带 "Upstream returned HTTP 502",title 里的状态码前缀去掉避免重复。
    const html = `<!DOCTYPE html><html class="no-js" lang="en-US"><head><title>502: Bad gateway</title><link rel="stylesheet" href="/cdn-cgi/styles/main.css"></head><body><h1>Bad gateway</h1><p>The web server returned an invalid response.</p><img src="/cdn-cgi/images/trace/502/edge.png"></body></html>`;
    expect(sanitizeImageError(html)).toBe('Bad gateway');
  });

  it('returns empty for html without a usable title', () => {
    const html =
      '<html><body><p>Bad gateway</p><a href="https://support.example.com/x">details</a></body></html>';
    expect(sanitizeImageError(html)).toBe('');
  });

  it('decodes basic entities in titles', () => {
    expect(
      sanitizeImageError(
        '<html><title>504 &amp; Gateway Timeout</title></html>'
      )
    ).toBe('504 & Gateway Timeout');
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
