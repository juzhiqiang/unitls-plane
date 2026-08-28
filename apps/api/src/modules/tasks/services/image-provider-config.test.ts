import { expect, it } from 'bun:test';
import {
  LEGACY_PROVIDER_ID,
  loadImageProviderConfigs,
  type ImageProviderEnv,
} from './image-provider-config';

/** 传显式 env 对象而不是改 process.env:测试之间不该互相污染进程状态。 */
function env(values: Record<string, string>): ImageProviderEnv {
  return values;
}

it('returns no provider when neither the list nor the legacy vars are set', () => {
  expect(loadImageProviderConfigs(env({}))).toEqual([]);
});

it('wraps the legacy single-provider vars into a default provider', () => {
  const [provider, ...rest] = loadImageProviderConfigs(
    env({
      AI_IMAGE_BASE_URL: 'https://api.legacy',
      AI_IMAGE_API_KEY: 'sk-legacy',
      AI_IMAGE_MODEL: 'gpt-image-1',
      AI_IMAGE_RESPONSE_FORMAT: 'b64_json',
    })
  );

  expect(rest).toHaveLength(0);
  expect(provider).toMatchObject({
    id: LEGACY_PROVIDER_ID,
    baseUrl: 'https://api.legacy',
    apiKey: 'sk-legacy',
    model: 'gpt-image-1',
    capabilities: ['generate', 'edit'],
    editTransport: 'multipart',
    responseFormat: 'b64_json',
  });
});

it('falls back to the default model when the legacy model var is set but empty', () => {
  const [provider] = loadImageProviderConfigs(
    env({ AI_IMAGE_BASE_URL: 'https://api.legacy', AI_IMAGE_MODEL: '' })
  );

  expect(provider?.model).toBe('gpt-image-1');
});

it('prefers the provider list over the legacy vars', () => {
  const providers = loadImageProviderConfigs(
    env({
      AI_IMAGE_BASE_URL: 'https://api.legacy',
      AI_IMAGE_PROVIDERS: JSON.stringify([
        { id: 'primary', label: '主来源', baseUrl: 'https://api.primary' },
      ]),
    })
  );

  expect(providers).toHaveLength(1);
  expect(providers[0]?.id).toBe('primary');
});

it('applies OpenAI-compatible defaults to a minimal entry', () => {
  const [provider] = loadImageProviderConfigs(
    env({
      AI_IMAGE_PROVIDERS: JSON.stringify([
        { id: 'primary', label: '主来源', baseUrl: 'https://api.primary' },
      ]),
    })
  );

  expect(provider).toMatchObject({
    model: 'gpt-image-1',
    capabilities: ['generate', 'edit'],
    editTransport: 'multipart',
    refImagesField: 'reference_images',
    refImageEncoding: 'data_url',
    responseFormat: 'b64_json',
    omitBodyFields: [],
  });
  expect(provider?.apiKey).toBeUndefined();
});

it('reads omitBodyFields and drops duplicates', () => {
  const [provider] = loadImageProviderConfigs(
    env({
      AI_IMAGE_PROVIDERS: JSON.stringify([
        {
          id: 'wan',
          label: '通义万相',
          baseUrl: 'https://wan.example.com',
          model: 'wan2.2-t2i',
          omitBodyFields: ['quality', 'response_format', 'quality'],
        },
      ]),
    })
  );

  expect(provider?.omitBodyFields).toEqual(['quality', 'response_format']);
});

it('rejects an unknown omitBodyFields entry', () => {
  expect(() =>
    loadImageProviderConfigs(
      env({
        AI_IMAGE_PROVIDERS: JSON.stringify([
          {
            id: 'wan',
            label: 'wan',
            baseUrl: 'https://wan.example.com',
            omitBodyFields: ['prompt'],
          },
        ]),
      })
    )
  ).toThrow(/AI_IMAGE_PROVIDERS is invalid/);
});

it('keeps configuration order so the first entry stays the default provider', () => {
  const providers = loadImageProviderConfigs(
    env({
      AI_IMAGE_PROVIDERS: JSON.stringify([
        { id: 'first', label: '一', baseUrl: 'https://api.one' },
        { id: 'second', label: '二', baseUrl: 'https://api.two' },
      ]),
    })
  );

  expect(providers.map(provider => provider.id)).toEqual(['first', 'second']);
});

it('reads a kmage-style provider that puts reference images in the generations body', () => {
  const [provider] = loadImageProviderConfigs(
    env({
      AI_IMAGE_PROVIDERS: JSON.stringify([
        {
          id: 'kmage',
          label: 'dddd.zone',
          baseUrl: 'https://image.dddd.zone',
          apiKey: 'kmage_key',
          model: 'gpt-image-2',
          editTransport: 'generations_ref',
          refImageEncoding: 'data_url',
        },
      ]),
    })
  );

  expect(provider).toMatchObject({
    editTransport: 'generations_ref',
    refImagesField: 'reference_images',
    refImageEncoding: 'data_url',
    model: 'gpt-image-2',
  });
});

it('accepts a generate-only provider', () => {
  const [provider] = loadImageProviderConfigs(
    env({
      AI_IMAGE_PROVIDERS: JSON.stringify([
        {
          id: 'txt',
          label: '只支持文生图',
          baseUrl: 'https://api.txt',
          capabilities: ['generate'],
        },
      ]),
    })
  );

  expect(provider?.capabilities).toEqual(['generate']);
});

it('fails fast on malformed JSON instead of silently disabling generation', () => {
  expect(() =>
    loadImageProviderConfigs(env({ AI_IMAGE_PROVIDERS: '[{' }))
  ).toThrow(/not valid JSON/);
});

it('rejects an empty provider list', () => {
  expect(() =>
    loadImageProviderConfigs(env({ AI_IMAGE_PROVIDERS: '[]' }))
  ).toThrow(/AI_IMAGE_PROVIDERS is invalid/);
});

it('rejects duplicate provider ids', () => {
  expect(() =>
    loadImageProviderConfigs(
      env({
        AI_IMAGE_PROVIDERS: JSON.stringify([
          { id: 'dup', label: '一', baseUrl: 'https://api.one' },
          { id: 'DUP', label: '二', baseUrl: 'https://api.two' },
        ]),
      })
    )
  ).toThrow(/duplicate provider id/);
});

it('rejects an unknown edit transport', () => {
  expect(() =>
    loadImageProviderConfigs(
      env({
        AI_IMAGE_PROVIDERS: JSON.stringify([
          {
            id: 'x',
            label: 'x',
            baseUrl: 'https://api.x',
            editTransport: 'telepathy',
          },
        ]),
      })
    )
  ).toThrow(/AI_IMAGE_PROVIDERS is invalid/);
});

it('rejects unknown keys so a typo cannot look like it took effect', () => {
  expect(() =>
    loadImageProviderConfigs(
      env({
        AI_IMAGE_PROVIDERS: JSON.stringify([
          {
            id: 'x',
            label: 'x',
            baseUrl: 'https://api.x',
            responseFromat: 'url',
          },
        ]),
      })
    )
  ).toThrow(/AI_IMAGE_PROVIDERS is invalid/);
});

it('never echoes the api key into the validation error', () => {
  const secret = 'sk-super-secret-value';
  const error = (() => {
    try {
      loadImageProviderConfigs(
        env({
          AI_IMAGE_PROVIDERS: JSON.stringify([
            { id: 'x', label: 'x', baseUrl: 'not-a-url', apiKey: secret },
          ]),
        })
      );
      return null;
    } catch (caught) {
      return caught as Error;
    }
  })();

  expect(error).not.toBeNull();
  expect(error?.message).not.toContain(secret);
});
