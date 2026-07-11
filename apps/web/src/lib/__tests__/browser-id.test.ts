import { afterEach, describe, expect, it } from 'vitest';
import { createBrowserId } from '../browser-id';

const originalCrypto = globalThis.crypto;

function setCrypto(value: Partial<Crypto> | undefined) {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value,
  });
}

describe('createBrowserId', () => {
  afterEach(() => {
    setCrypto(originalCrypto);
  });

  it('uses crypto.randomUUID when the browser provides it', () => {
    setCrypto({
      randomUUID: () => 'uuid-from-browser',
    } as Partial<Crypto>);

    expect(createBrowserId()).toBe('uuid-from-browser');
  });

  it('falls back to getRandomValues when randomUUID is unavailable', () => {
    setCrypto({
      getRandomValues: array => {
        const bytes = array as Uint8Array;
        bytes.fill(7);
        return array;
      },
    } as Partial<Crypto>);

    expect(createBrowserId()).toBe('07070707070707070707070707070707');
  });
});
