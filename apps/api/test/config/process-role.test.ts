import { describe, expect, it } from 'bun:test';
import { parseProcessRole } from '../../src/config/process-role';

describe('parseProcessRole', () => {
  it('defaults to all when PROCESS_ROLE is unset', () => {
    expect(parseProcessRole(undefined)).toBe('all');
    expect(parseProcessRole('')).toBe('all');
  });

  it('accepts the three supported roles', () => {
    expect(parseProcessRole('all')).toBe('all');
    expect(parseProcessRole('api')).toBe('api');
    expect(parseProcessRole('worker')).toBe('worker');
  });

  it('normalizes surrounding whitespace and casing', () => {
    expect(parseProcessRole(' API ')).toBe('api');
    expect(parseProcessRole('Worker')).toBe('worker');
  });

  it('rejects unsupported roles instead of falling back to all', () => {
    expect(() => parseProcessRole('scheduler')).toThrow(/PROCESS_ROLE/);
    expect(() => parseProcessRole('api2')).toThrow(/PROCESS_ROLE/);
  });
});
