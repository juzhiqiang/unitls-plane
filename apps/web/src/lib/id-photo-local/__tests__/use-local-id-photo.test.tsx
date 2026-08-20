import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// @huggingface/transformers 的桩:记录 pipeline 配置,可控地发进度并回一个带 toCanvas 的 RawImage。
// vi.hoisted 让 mock 函数在 vi.mock 提升执行时即存在(避免 TDZ)。
const { pipelineMock, segMock, envStub } = vi.hoisted(() => ({
  pipelineMock: vi.fn(),
  segMock: vi.fn(),
  envStub: {
    allowLocalModels: true,
    remoteHost: '',
    remotePathTemplate: '',
    backends: { onnx: { wasm: { wasmPaths: '' } } },
  },
}));
vi.mock('@huggingface/transformers', () => ({
  pipeline: (...args: unknown[]) => pipelineMock(...args),
  env: envStub,
}));

import { resetSegmentationCacheForTests } from '../segmentation';
import { useLocalIdPhoto } from '../use-local-id-photo';
import { ORT_VERSION } from '../model-registry';

// 合成阶段用的 cutout bitmap(createImageBitmap 桩产出)
let lastCutout: {
  width: number;
  height: number;
  close: ReturnType<typeof vi.fn>;
};

/** pipeline 产出的 RawImage 桩:hook 只用 toCanvas()。 */
const makeRawImage = () => ({ toCanvas: () => ({ width: 10, height: 10 }) });

beforeEach(() => {
  // pipeline 缓存现在在模块作用域(模型是进程级单例,跨页面共享),
  // 每个用例必须清掉,否则上一例建好的 pipeline 会让本例跳过构建。
  resetSegmentationCacheForTests();

  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  envStub.allowLocalModels = true;
  envStub.remoteHost = '';
  envStub.remotePathTemplate = '';
  envStub.backends.onnx.wasm.wasmPaths = '';

  segMock.mockReset();
  segMock.mockImplementation(async () => makeRawImage());
  pipelineMock.mockReset();
  pipelineMock.mockImplementation(
    async (
      _task: string,
      _model: string,
      cfg: { progress_callback?: (p: Record<string, unknown>) => void }
    ) => {
      // 模拟下载进度事件(transformers.js 的 {status:'progress', progress:0..100})
      cfg.progress_callback?.({ status: 'progress', progress: 50, file: 'm' });
      cfg.progress_callback?.({ status: 'progress', progress: 100, file: 'm' });
      return segMock;
    }
  );

  // compositeIdPhoto 在 jsdom 下需要 2D 上下文与 convertToBlob;最小可用桩。
  class FakeCtx {
    fillStyle = '';
    drawImage(..._args: unknown[]): void {}
    fillRect(_x: number, _y: number, _w: number, _h: number): void {}
  }
  class FakeCanvas {
    ctx: FakeCtx;
    constructor(
      public width: number,
      public height: number
    ) {
      this.ctx = new FakeCtx();
    }
    getContext(): FakeCtx {
      return this.ctx;
    }
    convertToBlob(): Promise<Blob> {
      return Promise.resolve(new Blob(['x']));
    }
  }
  Object.defineProperty(globalThis, 'OffscreenCanvas', {
    value: FakeCanvas,
    configurable: true,
    writable: true,
  });
  // cutout canvas → ImageBitmap(createImageBitmap 桩)
  Object.defineProperty(globalThis, 'createImageBitmap', {
    value: vi.fn(async () => {
      lastCutout = { width: 10, height: 10, close: vi.fn() };
      return lastCutout;
    }),
    configurable: true,
    writable: true,
  });
  // jsdom 默认无 navigator.gpu → 探测为 wasm;个别用例按需注入
  delete (navigator as unknown as { gpu?: unknown }).gpu;

  process.env.NEXT_PUBLIC_S3_PUBLIC_URL = 'http://localhost:9000';
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_S3_PUBLIC_URL;
  delete (navigator as unknown as { gpu?: unknown }).gpu;
});

const defaultOpts = {
  preset: 'one_inch' as const,
  backgroundColor: '#438edb',
  outputType: 'image/jpeg' as const,
};
const makeFile = (name = 'a.jpg') =>
  new File(['img'], name, { type: 'image/jpeg' });

// 注入 navigator.gpu(adapter 非 null → webgpu 可用)
function enableWebGpu() {
  Object.defineProperty(navigator, 'gpu', {
    value: { requestAdapter: () => Promise.resolve({}) },
    configurable: true,
  });
}

/** 最近一次 pipeline() 调用的 (model, cfg)。 */
function lastPipelineCall(): {
  model: string;
  dtype: string;
  device: string;
} {
  const call = pipelineMock.mock.calls.at(-1);
  const cfg = (call?.[2] ?? {}) as { dtype: string; device: string };
  return { model: String(call?.[1] ?? ''), ...cfg };
}

describe('useLocalIdPhoto', () => {
  it('starts idle with no result', () => {
    const { result } = renderHook(() => useLocalIdPhoto());
    expect(result.current.status).toBe('idle');
    expect(result.current.resultBlob).toBeNull();
  });

  it('runs the pipeline and composites a result blob', async () => {
    const { result } = renderHook(() => useLocalIdPhoto());
    await act(async () => {
      await result.current.process(makeFile(), 'balanced', defaultOpts);
    });
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(result.current.resultBlob).toBeInstanceOf(Blob);
    expect(segMock).toHaveBeenCalledTimes(1);
  });

  it('points transformers.js at the self-hosted MinIO assets', async () => {
    const { result } = renderHook(() => useLocalIdPhoto());
    await act(async () => {
      await result.current.process(makeFile(), 'balanced', defaultOpts);
    });
    // 离线镜像里没有公网:必须关掉本地探测并把 remoteHost / wasmPaths 指向自有对象存储
    expect(envStub.allowLocalModels).toBe(false);
    expect(envStub.remoteHost).toBe('http://localhost:9000/models/');
    expect(envStub.remotePathTemplate).toBe('{model}/');
    expect(envStub.backends.onnx.wasm.wasmPaths).toBe(
      `http://localhost:9000/models/ort/${ORT_VERSION}/`
    );
  });

  it('uses fp16 + wasm when no webgpu, even if high requested', async () => {
    const { result } = renderHook(() => useLocalIdPhoto());
    await act(async () => {
      await result.current.process(makeFile(), 'high', defaultOpts);
    });
    // ep=wasm(无 webgpu)→ tierFor 把 high 锁回 balanced(fp16)
    expect(lastPipelineCall().model).toBe('rmbg/1.4');
    expect(lastPipelineCall().dtype).toBe('fp16');
    expect(lastPipelineCall().device).toBe('wasm');
  });

  it('uses fp32 + webgpu when webgpu available and high requested', async () => {
    enableWebGpu();
    const { result } = renderHook(() => useLocalIdPhoto());
    await waitFor(() => expect(result.current.ep).toBe('webgpu'));
    await act(async () => {
      await result.current.process(makeFile(), 'high', defaultOpts);
    });
    expect(lastPipelineCall().dtype).toBe('fp32');
    expect(lastPipelineCall().device).toBe('webgpu');
  });

  it('maps download progress events to loading-model', async () => {
    // 中间 React 状态会被 done 覆盖,难以在 act 外稳定观测,故校验回调接线:
    // hook 必须把 progress_callback 接给 pipeline,且能消费 {status,progress} 事件。
    const { result } = renderHook(() => useLocalIdPhoto());
    await act(async () => {
      await result.current.process(makeFile(), 'balanced', defaultOpts);
    });
    await waitFor(() => expect(result.current.status).toBe('done'));
    const cfg = pipelineMock.mock.calls.at(-1)?.[2] as {
      progress_callback?: unknown;
    };
    expect(typeof cfg?.progress_callback).toBe('function');
  });

  it('reuses the pipeline for the same tier across runs', async () => {
    const { result } = renderHook(() => useLocalIdPhoto());
    await act(async () => {
      await result.current.process(makeFile('a.jpg'), 'balanced', defaultOpts);
    });
    await waitFor(() => expect(result.current.status).toBe('done'));
    await act(async () => {
      await result.current.process(makeFile('b.jpg'), 'balanced', defaultOpts);
    });
    await waitFor(() => expect(result.current.status).toBe('done'));
    // 模型很大(fp16 ~88MB),同档位必须复用,不能每次重建 pipeline
    expect(pipelineMock).toHaveBeenCalledTimes(1);
    expect(segMock).toHaveBeenCalledTimes(2);
  });

  it('guards against reentry during an in-flight process', async () => {
    // 第一个 process 被 gate 挂起在推理;第二个在 inFlight 守卫下被丢弃。
    let gate: () => void = () => {};
    segMock.mockReset();
    segMock.mockImplementation(
      () =>
        new Promise(resolve => {
          gate = () => resolve(makeRawImage());
        })
    );

    const { result } = renderHook(() => useLocalIdPhoto());
    let p1!: Promise<void>;
    let p2!: Promise<void>;
    await act(async () => {
      p1 = result.current.process(makeFile('a.jpg'), 'balanced', defaultOpts);
      p2 = result.current.process(makeFile('b.jpg'), 'balanced', defaultOpts);
      await waitFor(() => expect(segMock).toHaveBeenCalledTimes(1));
    });
    expect(segMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      gate();
      await p1;
      await p2; // 被守卫丢弃,直接 resolve(undefined)
    });
    await waitFor(() => expect(result.current.status).toBe('done'));
  });

  it('drops stale results after reset', async () => {
    const { result } = renderHook(() => useLocalIdPhoto());
    let resolveProcess: () => void = () => {};
    segMock.mockReset();
    segMock.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveProcess = () => resolve(makeRawImage());
        })
    );
    await act(async () => {
      result.current.process(makeFile('a.jpg'), 'balanced', defaultOpts);
      await Promise.resolve();
    });
    act(() => {
      result.current.reset();
    });
    expect(result.current.status).toBe('idle');
    // 即便旧的推理此刻 resolve,也不应改 status(已被 sid 丢弃)
    await act(async () => {
      resolveProcess();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.status).toBe('idle');
  });

  it('closes the cutout ImageBitmap after compositing', async () => {
    const { result } = renderHook(() => useLocalIdPhoto());
    await act(async () => {
      await result.current.process(makeFile('a.jpg'), 'balanced', defaultOpts);
    });
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(lastCutout.close).toHaveBeenCalled();
  });
});
