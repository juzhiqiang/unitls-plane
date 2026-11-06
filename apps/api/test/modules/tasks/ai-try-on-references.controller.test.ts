import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { AiTryOnReferencesController } from '../../../src/modules/tasks/ai-try-on-references.controller';

// 控制器很薄:只负责把 kind/lang 透传给 service(lang 缺省 zh)。
// 过滤、语言拼装与许可校验由 ai-try-on-references.service.test.ts 覆盖。
const aiTryOnReferencesService = {
  list: vi.fn(),
};

function createController() {
  return new AiTryOnReferencesController(aiTryOnReferencesService as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  aiTryOnReferencesService.list.mockResolvedValue([]);
});

describe('AiTryOnReferencesController', () => {
  it('forwards kind and defaults lang to zh', async () => {
    await createController().listReferences({ kind: 'person' } as never);

    expect(aiTryOnReferencesService.list).toHaveBeenCalledWith('person', 'zh');
  });

  it('passes an explicit lang through', async () => {
    await createController().listReferences({
      kind: 'garment',
      lang: 'en',
    } as never);

    expect(aiTryOnReferencesService.list).toHaveBeenCalledWith('garment', 'en');
  });

  it('marks the public catalog as conditionally cacheable', async () => {
    const response = { setHeader: vi.fn() };
    await createController().listReferences(
      { kind: 'pose', lang: 'zh' } as never,
      response as never
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'public, max-age=0, must-revalidate'
    );
  });

  it('exposes a public GET route under /tasks/ai-try-on/references', () => {
    const prototype = AiTryOnReferencesController.prototype as Record<
      string,
      (...args: unknown[]) => unknown
    >;

    expect(Reflect.getMetadata('path', AiTryOnReferencesController)).toBe(
      'tasks'
    );
    expect(Reflect.getMetadata('path', prototype.listReferences)).toBe(
      'ai-try-on/references'
    );
    expect(Reflect.getMetadata('method', prototype.listReferences)).toBe(0);
    // 素材检索不要求登录,但响应绝不含 bucket / storage key。
    expect(Reflect.getMetadata('isPublic', prototype.listReferences)).toBe(
      true
    );
  });
});
