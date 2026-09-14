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

it('wraps the legacy single-provider vars into a default provider with one model', () => {
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
    models: [
      {
        name: 'gpt-image-1',
        capabilities: ['generate', 'edit'],
        sizes: [
          '1024x1024',
          '1024x1536',
          '1536x1024',
          '864x1152',
          '1152x864',
          '864x1536',
          '1536x864',
        ],
      },
    ],
    editTransport: 'multipart',
    responseFormat: 'b64_json',
  });
});

it('falls back to the default model when the legacy model var is set but empty', () => {
  const [provider] = loadImageProviderConfigs(
    env({ AI_IMAGE_BASE_URL: 'https://api.legacy', AI_IMAGE_MODEL: '' })
  );

  expect(provider?.models[0]?.name).toBe('gpt-image-1');
});

it('prefers the provider list over the legacy vars', () => {
  const providers = loadImageProviderConfigs(
    env({
      AI_IMAGE_BASE_URL: 'https://api.legacy',
      AI_IMAGE_PROVIDERS: JSON.stringify([
        {
          id: 'primary',
          label: '主来源',
          baseUrl: 'https://api.primary',
          models: [{ name: 'gpt-image-1' }],
        },
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
        {
          id: 'primary',
          label: '主来源',
          baseUrl: 'https://api.primary',
          models: [{ name: 'gpt-image-1' }],
        },
      ]),
    })
  );

  expect(provider).toMatchObject({
    models: [
      {
        name: 'gpt-image-1',
        capabilities: ['generate', 'edit'],
        sizes: [
          '1024x1024',
          '1024x1536',
          '1536x1024',
          '864x1152',
          '1152x864',
          '864x1536',
          '1536x864',
        ],
      },
    ],
    editTransport: 'multipart',
    refImagesField: 'reference_images',
    refImageEncoding: 'data_url',
    responseFormat: 'b64_json',
    omitBodyFields: [],
  });
  expect(provider?.apiKey).toBeUndefined();
});

it('supports multiple models under one provider with per-model declarations', () => {
  const [provider] = loadImageProviderConfigs(
    env({
      AI_IMAGE_PROVIDERS: JSON.stringify([
        {
          id: 'kmage',
          label: 'KMage',
          baseUrl: 'https://image.dddd.zone',
          models: [
            { name: 'KMage V2', capabilities: ['generate', 'edit'] },
            {
              name: 'gpt-image-2',
              capabilities: ['generate', 'edit', 'inpaint'],
              sizes: ['auto', '1024x1024'],
            },
          ],
        },
      ]),
    })
  );

  expect(provider?.models).toHaveLength(2);
  expect(provider?.models[0]).toMatchObject({
    name: 'KMage V2',
    capabilities: ['generate', 'edit'],
  });
  expect(provider?.models[1]).toMatchObject({
    name: 'gpt-image-2',
    capabilities: ['generate', 'edit', 'inpaint'],
    sizes: ['auto', '1024x1024'],
  });
});

it('allows the same model name under different providers', () => {
  const providers = loadImageProviderConfigs(
    env({
      AI_IMAGE_PROVIDERS: JSON.stringify([
        {
          id: 'openai',
          label: 'OpenAI',
          baseUrl: 'https://api.openai.com',
          models: [{ name: 'gpt-image-1' }],
        },
        {
          id: 'kmage',
          label: 'KMage',
          baseUrl: 'https://image.dddd.zone',
          models: [{ name: 'gpt-image-1' }],
        },
      ]),
    })
  );

  expect(providers).toHaveLength(2);
  expect(providers[0]?.models[0]?.name).toBe('gpt-image-1');
  expect(providers[1]?.models[0]?.name).toBe('gpt-image-1');
});

it('rejects duplicate model names within one provider (case-insensitive)', () => {
  expect(() =>
    loadImageProviderConfigs(
      env({
        AI_IMAGE_PROVIDERS: JSON.stringify([
          {
            id: 'x',
            label: 'x',
            baseUrl: 'https://api.x',
            models: [{ name: 'gpt-image-1' }, { name: 'GPT-Image-1' }],
          },
        ]),
      })
    )
  ).toThrow(/duplicate model name/);
});

it('rejects an empty models list', () => {
  expect(() =>
    loadImageProviderConfigs(
      env({
        AI_IMAGE_PROVIDERS: JSON.stringify([
          { id: 'x', label: 'x', baseUrl: 'https://api.x', models: [] },
        ]),
      })
    )
  ).toThrow(/AI_IMAGE_PROVIDERS is invalid/);
});

it('rejects the legacy flat format with an upgrade hint', () => {
  let caught: Error | null = null;
  try {
    loadImageProviderConfigs(
      env({
        AI_IMAGE_PROVIDERS: JSON.stringify([
          {
            id: 'x',
            label: 'x',
            baseUrl: 'https://api.x',
            model: 'gpt-image-1',
            capabilities: ['generate', 'edit'],
            sizes: ['1024x1024'],
          },
        ]),
      })
    );
  } catch (error) {
    caught = error as Error;
  }

  expect(caught).not.toBeNull();
  expect(caught?.message).toContain('AI_IMAGE_PROVIDERS is invalid');
  expect(caught?.message).toContain('format changed');
});

it('does not add the upgrade hint for unrelated validation errors', () => {
  let caught: Error | null = null;
  try {
    loadImageProviderConfigs(
      env({
        AI_IMAGE_PROVIDERS: JSON.stringify([
          {
            id: 'x',
            label: 'x',
            baseUrl: 'not-a-url',
            models: [{ name: 'gpt-image-1' }],
          },
        ]),
      })
    );
  } catch (error) {
    caught = error as Error;
  }

  expect(caught).not.toBeNull();
  expect(caught?.message).not.toContain('format changed');
});

it('reads declared sizes and drops duplicates', () => {
  const [provider] = loadImageProviderConfigs(
    env({
      AI_IMAGE_PROVIDERS: JSON.stringify([
        {
          id: 'sdxl',
          label: 'SDXL 网关',
          baseUrl: 'https://sdxl.example.com',
          models: [
            {
              name: 'sdxl-xl',
              sizes: ['1024x1024', '1344x768', '1024x1024', 'auto'],
            },
          ],
        },
      ]),
    })
  );

  expect(provider?.models[0]?.sizes).toEqual(['1024x1024', '1344x768', 'auto']);
});

it('rejects a malformed size entry', () => {
  expect(() =>
    loadImageProviderConfigs(
      env({
        AI_IMAGE_PROVIDERS: JSON.stringify([
          {
            id: 'sdxl',
            label: 'sdxl',
            baseUrl: 'https://sdxl.example.com',
            models: [{ name: 'sdxl-xl', sizes: ['square'] }],
          },
        ]),
      })
    )
  ).toThrow(/AI_IMAGE_PROVIDERS is invalid/);
});

it('rejects an empty sizes list', () => {
  expect(() =>
    loadImageProviderConfigs(
      env({
        AI_IMAGE_PROVIDERS: JSON.stringify([
          {
            id: 'sdxl',
            label: 'sdxl',
            baseUrl: 'https://sdxl.example.com',
            models: [{ name: 'sdxl-xl', sizes: [] }],
          },
        ]),
      })
    )
  ).toThrow(/AI_IMAGE_PROVIDERS is invalid/);
});

it('allows background in omitBodyFields', () => {
  const [provider] = loadImageProviderConfigs(
    env({
      AI_IMAGE_PROVIDERS: JSON.stringify([
        {
          id: 'wan',
          label: 'wan',
          baseUrl: 'https://wan.example.com',
          models: [{ name: 'wan2.2-t2i' }],
          omitBodyFields: ['background'],
        },
      ]),
    })
  );

  expect(provider?.omitBodyFields).toEqual(['background']);
});

it('reads omitBodyFields and drops duplicates', () => {
  const [provider] = loadImageProviderConfigs(
    env({
      AI_IMAGE_PROVIDERS: JSON.stringify([
        {
          id: 'wan',
          label: '通义万相',
          baseUrl: 'https://wan.example.com',
          models: [{ name: 'wan2.2-t2i' }],
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
            models: [{ name: 'wan2.2-t2i' }],
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
        {
          id: 'first',
          label: '一',
          baseUrl: 'https://api.one',
          models: [{ name: 'gpt-image-1' }],
        },
        {
          id: 'second',
          label: '二',
          baseUrl: 'https://api.two',
          models: [{ name: 'KMage V2' }],
        },
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
          models: [{ name: 'gpt-image-2' }],
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
    models: [{ name: 'gpt-image-2' }],
  });
});

it('accepts a generate-only model', () => {
  const [provider] = loadImageProviderConfigs(
    env({
      AI_IMAGE_PROVIDERS: JSON.stringify([
        {
          id: 'txt',
          label: '只支持文生图',
          baseUrl: 'https://api.txt',
          models: [{ name: 'txt-only', capabilities: ['generate'] }],
        },
      ]),
    })
  );

  expect(provider?.models[0]?.capabilities).toEqual(['generate']);
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
          {
            id: 'dup',
            label: '一',
            baseUrl: 'https://api.one',
            models: [{ name: 'gpt-image-1' }],
          },
          {
            id: 'DUP',
            label: '二',
            baseUrl: 'https://api.two',
            models: [{ name: 'gpt-image-1' }],
          },
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
            models: [{ name: 'gpt-image-1' }],
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
            models: [{ name: 'gpt-image-1' }],
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
            {
              id: 'x',
              label: 'x',
              baseUrl: 'not-a-url',
              apiKey: secret,
              models: [{ name: 'gpt-image-1' }],
            },
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
