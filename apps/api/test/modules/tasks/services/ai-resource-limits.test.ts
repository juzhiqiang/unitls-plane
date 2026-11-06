import { expect, it, vi } from 'bun:test';
import { runWithTaskResources } from '../../../../src/common/resources/task-resource-context';
import { resourceLimits } from '../../../../src/common/resources/resource-limits';
import { TaskResourceLimitError } from '../../../../src/common/resources/resource-error';
import { bufferFromGeneratedImagePayload } from '../../../../src/modules/tasks/services/openai-compatible-image';
import {
  OpenAiCompatibleImageGenerationProvider,
  ImageGenerationService,
} from '../../../../src/modules/tasks/services/image-generation.service';

const config = {
  mode: 'text_to_image' as const,
  prompt: 'hello',
  size: '1024x1024' as const,
  quality: 'high' as const,
  inputFileCount: 0,
};
const resources = {
  limits: {
    ...resourceLimits({}),
    generatedImageBytes: 3,
    providerResponseBytes: 64,
  },
  inputBytes: 0,
  files: new Map(),
};

it('证件照 AI 响应同样限制 JSON 体积', async () => {
  const { OpenAiCompatiblePortraitSegmentationProvider } =
    await import('../../../../src/modules/tasks/services/portrait-segmentation.service');
  const sharp = (await import('sharp')).default;
  const png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: 'white' },
  })
    .png()
    .toBuffer();
  const fetchImpl = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ data: [{ b64_json: png.toString('base64') }] })
      )
  );
  const provider = new OpenAiCompatiblePortraitSegmentationProvider({
    baseUrl: 'https://test',
    provider: 'image_result',
    fetch: fetchImpl as never,
  });
  await expect(
    runWithTaskResources(resources, () =>
      provider.renderIdPhoto(png, {
        width: 2,
        height: 2,
        backgroundColor: '#ffffff',
        outputType: 'image/png',
      })
    )
  ).rejects.toBeInstanceOf(TaskResourceLimitError);
});

it('base64 及非标准 url 字段均在解码前检查体积', async () => {
  for (const payload of [
    { b64_json: 'YWFhYWFh' },
    { url: 'YWFhYWFh' },
    { url: 'data:image/png;base64,YWFhYWFh' },
  ]) {
    const fetchImpl = vi.fn();
    await expect(
      runWithTaskResources(resources, () =>
        bufferFromGeneratedImagePayload({ data: [payload] }, fetchImpl as never)
      )
    ).rejects.toBeInstanceOf(TaskResourceLimitError);
    expect(fetchImpl).not.toHaveBeenCalled();
  }
});

it('URL 下载按实际体积拒绝，并传入超时 signal', async () => {
  const fetchImpl = vi.fn(async () => new Response('four'));
  await expect(
    runWithTaskResources(resources, () =>
      bufferFromGeneratedImagePayload(
        { data: [{ url: 'https://test/image' }] },
        fetchImpl as never
      )
    )
  ).rejects.toBeInstanceOf(TaskResourceLimitError);
  expect(fetchImpl).toHaveBeenCalledWith('https://test/image', {
    signal: expect.any(globalThis.AbortSignal),
  });
});

it('上游 JSON 超限保持确定性错误，不重新发起收费请求或换源', async () => {
  const fetchImpl = vi.fn(
    async () =>
      new Response(JSON.stringify({ data: [{ b64_json: 'a'.repeat(100) }] }))
  );
  const first = new OpenAiCompatibleImageGenerationProvider({
    id: 'first',
    baseUrl: 'https://test',
    model: 'gpt-image-1',
    fetch: fetchImpl as never,
  });
  const secondFetch = vi.fn();
  const second = new OpenAiCompatibleImageGenerationProvider({
    id: 'second',
    baseUrl: 'https://test',
    model: 'gpt-image-1',
    fetch: secondFetch as never,
  });
  const service = new ImageGenerationService({
    providers: [first, second],
    random: () => 0,
  });
  await expect(
    runWithTaskResources(resources, () => service.generate(config))
  ).rejects.toBeInstanceOf(TaskResourceLimitError);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(secondFetch).not.toHaveBeenCalled();
});
