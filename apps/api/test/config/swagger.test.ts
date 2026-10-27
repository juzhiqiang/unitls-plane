import { describe, expect, it } from 'bun:test';
import {
  buildSwaggerConfig,
  parseSwaggerEnabled,
} from '../../src/config/swagger';

describe('parseSwaggerEnabled', () => {
  it('defaults to disabled in production', () => {
    expect(parseSwaggerEnabled(undefined, 'production')).toBe(false);
    expect(parseSwaggerEnabled('', 'production')).toBe(false);
  });

  it('defaults to enabled outside production', () => {
    expect(parseSwaggerEnabled(undefined, 'development')).toBe(true);
    expect(parseSwaggerEnabled(undefined, 'test')).toBe(true);
    expect(parseSwaggerEnabled(undefined, undefined)).toBe(true);
  });

  it('lets an explicit value override the environment default', () => {
    expect(parseSwaggerEnabled('true', 'production')).toBe(true);
    expect(parseSwaggerEnabled('false', 'development')).toBe(false);
    expect(parseSwaggerEnabled(' TRUE ', 'production')).toBe(true);
    expect(parseSwaggerEnabled('False', 'development')).toBe(false);
  });

  it('rejects values other than true and false', () => {
    expect(() => parseSwaggerEnabled('yes', 'production')).toThrow(
      /SWAGGER_ENABLED/
    );
    expect(() => parseSwaggerEnabled('1', 'development')).toThrow(
      /SWAGGER_ENABLED/
    );
  });
});

describe('buildSwaggerConfig', () => {
  it('keeps the existing document metadata', () => {
    const config = buildSwaggerConfig();

    expect(config.info.title).toBe('Utils-Plane API');
    expect(config.info.description).toBe('工具平台 API 文档');
    expect(config.info.version).toBe('1.0');
    expect(config.components?.securitySchemes).toHaveProperty('bearer');
  });
});
