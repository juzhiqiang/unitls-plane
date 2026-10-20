import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 推理层已在 segmentation.test.ts 单独覆盖;这里只验证 hook 的编排
// (重入守卫、进度接线、过期丢弃、合成与资源释放)。
const {
  segmentMock,
  faceDetectMock,
  compositeMock,
  actualComposite,
  suggestLayoutMock,
  actualValidators,
} = vi.hoisted(() => ({
  segmentMock: vi.fn(),
  faceDetectMock: vi.fn(),
  compositeMock: vi.fn(),
  // composite 的真实实现由模块工厂在导入时填进来;既有用例继续走真实合成,
  // 自动构图用例再把它替换成 spy 以便断言传入的 crop。
  actualComposite: {} as { impl?: (...args: unknown[]) => unknown },
  // 自动构图默认走真实实现;个别用例用它观察入参或注入异常输出。
  suggestLayoutMock: vi.fn(),
  actualValidators: {} as {
    suggestIdPhotoLayout?: (...args: unknown[]) => unknown;
  },
}));

vi.mock('@utils-plane/validators', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@utils-plane/validators')>();
  actualValidators.suggestIdPhotoLayout =
    actual.suggestIdPhotoLayout as unknown as (...args: unknown[]) => unknown;
  return {
    ...actual,
    suggestIdPhotoLayout: (...args: unknown[]) => suggestLayoutMock(...args),
  };
});

vi.mock('@/lib/id-photo-local/segmentation', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/lib/id-photo-local/segmentation')>();
  return {
    ...actual,
    segmentToCutout: (...args: unknown[]) => segmentMock(...args),
  };
});

vi.mock('@/lib/id-photo-local/face-detection', async importOriginal => {
  const actual =
    await importOriginal<
      typeof import('@/lib/id-photo-local/face-detection')
    >();
  return {
    ...actual,
    detectFaces: (...args: unknown[]) => faceDetectMock(...args),
  };
});

vi.mock('@/lib/id-photo-local/composite', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/lib/id-photo-local/composite')>();
  actualComposite.impl = actual.compositeIdPhoto as unknown as (
    ...args: unknown[]
  ) => unknown;
  return {
    ...actual,
    compositeIdPhoto: (...args: unknown[]) => compositeMock(...args),
  };
});

import { idPhotoCropSchema, idPhotoPresetSpecs } from '@utils-plane/validators';
import {
  ID_PHOTO_LOCAL_MAX_SOURCE_EDGE,
  useLocalIdPhoto,
} from '@/lib/id-photo-local/use-local-id-photo';

let lastCutout: {
  width: number;
  height: number;
  close: ReturnType<typeof vi.fn>;
};
let lastSource: {
  width: number;
  height: number;
  close: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  process.env.NEXT_PUBLIC_S3_PUBLIC_URL = 'http://localhost:9000';

  lastCutout = { width: 10, height: 10, close: vi.fn() };
  lastSource = { width: 10, height: 10, close: vi.fn() };
  segmentMock.mockReset();
  segmentMock.mockImplementation(async () => ({
    bitmap: lastCutout,
    source: lastSource,
  }));
  faceDetectMock.mockReset();
  faceDetectMock.mockResolvedValue([]);
  compositeMock.mockReset();
  compositeMock.mockImplementation((...args: unknown[]) =>
    actualComposite.impl!(...args)
  );
  suggestLayoutMock.mockReset();
  suggestLayoutMock.mockImplementation((...args: unknown[]) =>
    actualValidators.suggestIdPhotoLayout!(...args)
  );

  // compositeIdPhoto 在 jsdom 下需要 2D 上下文与 convertToBlob;最小可用桩。
  class FakeCtx {
    fillStyle = '';
    drawImage(..._args: unknown[]): void {}
    fillRect(_x: number, _y: number, _w: number, _h: number): void {}
    getImageData(
      _x: number,
      _y: number,
      width: number,
      height: number
    ): { data: Uint8ClampedArray } {
      return { data: new Uint8ClampedArray(width * height * 4).fill(255) };
    }
    putImageData(): void {}
    translate(): void {}
    rotate(): void {}
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
  Object.defineProperty(globalThis, 'ImageData', {
    value: class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number
      ) {}
    },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'OffscreenCanvas', {
    value: FakeCanvas,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'createImageBitmap', {
    value: vi.fn(async () => ({ width: 10, height: 10, close: vi.fn() })),
    configurable: true,
    writable: true,
  });
  // jsdom 默认无 navigator.gpu → 探测为 wasm;个别用例按需注入
  delete (navigator as unknown as { gpu?: unknown }).gpu;
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

/** 最近一次 segmentToCutout 调用的 (file, tier, ep, options)。 */
function lastSegmentCall(): {
  file: File;
  tier: string;
  ep: string;
  options: {
    onDownloadProgress?: (ratio: number) => void;
    isStale?: () => boolean;
  };
} {
  const [file, tier, ep, options] = segmentMock.mock.calls.at(-1) ?? [];
  return { file, tier, ep, options };
}

describe('useLocalIdPhoto', () => {
  it('starts idle with no result', () => {
    const { result } = renderHook(() => useLocalIdPhoto());
    expect(result.current.status).toBe('idle');
    expect(result.current.resultBlob).toBeNull();
  });

  it('runs segmentation and composites a result blob', async () => {
    const { result } = renderHook(() => useLocalIdPhoto());
    await act(async () => {
      await result.current.process(makeFile(), 'balanced', defaultOpts);
    });
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(result.current.resultBlob).toBeInstanceOf(Blob);
    expect(segmentMock).toHaveBeenCalledTimes(1);
    expect(lastSegmentCall().tier).toBe('balanced');
    expect(lastSegmentCall().ep).toBe('wasm');
  });

  it('uses webgpu when available and passes the requested tier', async () => {
    enableWebGpu();
    const { result } = renderHook(() => useLocalIdPhoto());
    await waitFor(() => expect(result.current.ep).toBe('webgpu'));
    await act(async () => {
      await result.current.process(makeFile(), 'high', defaultOpts);
    });
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(lastSegmentCall().tier).toBe('high');
    expect(lastSegmentCall().ep).toBe('webgpu');
  });

  it('maps download progress into progress state', async () => {
    // 中间 React 状态会被 done 覆盖,难以在 act 外稳定观测,故校验回调接线:
    // hook 必须把 onDownloadProgress 接给 segmentation,并消费 0..1 比例。
    segmentMock.mockImplementation(
      async (
        _file: File,
        _tier: string,
        _ep: string,
        options: { onDownloadProgress?: (ratio: number) => void }
      ) => {
        options.onDownloadProgress?.(0.5);
        return {
          bitmap: lastCutout,
          source: lastSource,
        };
      }
    );

    const { result } = renderHook(() => useLocalIdPhoto());
    await act(async () => {
      await result.current.process(makeFile(), 'balanced', defaultOpts);
    });
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(result.current.progress).toBe(0.5);
    expect(typeof lastSegmentCall().options.onDownloadProgress).toBe(
      'function'
    );
  });

  it('guards against reentry during an in-flight process', async () => {
    let gate: () => void = () => {};
    segmentMock.mockImplementation(
      () =>
        new Promise(resolve => {
          gate = () =>
            resolve({
              bitmap: lastCutout,
              source: lastSource,
            });
        })
    );

    const { result } = renderHook(() => useLocalIdPhoto());
    let p1!: Promise<void>;
    let p2!: Promise<void>;
    await act(async () => {
      p1 = result.current.process(makeFile('a.jpg'), 'balanced', defaultOpts);
      p2 = result.current.process(makeFile('b.jpg'), 'balanced', defaultOpts);
      await waitFor(() => expect(segmentMock).toHaveBeenCalledTimes(1));
    });
    expect(segmentMock).toHaveBeenCalledTimes(1);
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
    segmentMock.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveProcess = () =>
            resolve({
              bitmap: lastCutout,
              source: lastSource,
            });
        })
    );
    await act(async () => {
      result.current.process(makeFile('a.jpg'), 'balanced', defaultOpts);
      await Promise.resolve();
    });
    act(() => {
      result.current.resetAll();
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

  it('surfaces segmentation failures as error state', async () => {
    segmentMock.mockRejectedValueOnce(new Error('ort backend failed'));
    const { result } = renderHook(() => useLocalIdPhoto());
    await act(async () => {
      await result.current.process(makeFile('a.jpg'), 'balanced', defaultOpts);
    });
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('ort backend failed');
  });

  it('closes the cutout ImageBitmap after compositing', async () => {
    const { result } = renderHook(() => useLocalIdPhoto());
    await act(async () => {
      await result.current.process(makeFile('a.jpg'), 'balanced', defaultOpts);
    });
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(lastCutout.close).toHaveBeenCalled();
  });

  it('passes the original image to compositing so background estimation matches the server', async () => {
    const { result } = renderHook(() => useLocalIdPhoto());
    await act(async () => {
      await result.current.process(makeFile('a.jpg'), 'balanced', defaultOpts);
    });
    await waitFor(() => expect(result.current.status).toBe('done'));

    // 底色必须从原图在成片尺寸上估计,不能从背景 RGB 已被归零的 cutout 反推。
    expect(compositeMock.mock.calls[0]![7]).toBe(lastSource);
    expect(lastSource.close).toHaveBeenCalled();
  });

  it('reuses the segmentation source instead of decoding the file again', async () => {
    const { result } = renderHook(() => useLocalIdPhoto());
    await act(async () => {
      await result.current.process(makeFile('a.jpg'), 'balanced', defaultOpts);
    });
    await waitFor(() => expect(result.current.status).toBe('done'));

    // 分割已经解码过原图(并按上限缩放),hook 不能再解码第二次。
    expect(globalThis.createImageBitmap).not.toHaveBeenCalled();
    expect(compositeMock.mock.calls[0]![7]).toBe(lastSource);
  });

  it('asks segmentation to cap the source long edge at 2048', async () => {
    const { result } = renderHook(() => useLocalIdPhoto());
    await act(async () => {
      await result.current.process(makeFile('a.jpg'), 'balanced', defaultOpts);
    });

    expect(ID_PHOTO_LOCAL_MAX_SOURCE_EDGE).toBe(2048);
    expect(lastSegmentCall().options).toMatchObject({ maxSourceEdge: 2048 });
  });

  it('closes both bitmaps when the session goes stale right after segmentation', async () => {
    let release: () => void = () => {};
    segmentMock.mockImplementation(
      () =>
        new Promise(resolve => {
          release = () => resolve({ bitmap: lastCutout, source: lastSource });
        })
    );
    const { result } = renderHook(() => useLocalIdPhoto());
    await act(async () => {
      result.current.process(makeFile('a.jpg'), 'balanced', defaultOpts);
      await Promise.resolve();
    });
    act(() => result.current.resetAll());
    await act(async () => {
      release();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.status).toBe('idle');
    expect(lastCutout.close).toHaveBeenCalled();
    expect(lastSource.close).toHaveBeenCalled();
  });
});

describe('ID_PHOTO_LOCAL_MAX_SOURCE_EDGE', () => {
  it('leaves enough pixels for the largest preset at the maximum crop scale', () => {
    // 依据:IdPhotoCrop.scale 上限 3;最大规格二寸 413×626,626×3=1878 < 2048。
    expect(
      idPhotoCropSchema.safeParse({ x: 0.5, y: 0.5, scale: 3 }).success
    ).toBe(true);
    expect(
      idPhotoCropSchema.safeParse({ x: 0.5, y: 0.5, scale: 3.01 }).success
    ).toBe(false);
    for (const spec of Object.values(idPhotoPresetSpecs)) {
      expect(Math.max(spec.widthPx, spec.heightPx) * 3).toBeLessThanOrEqual(
        ID_PHOTO_LOCAL_MAX_SOURCE_EDGE
      );
    }
  });
});

describe('useLocalIdPhoto auto framing', () => {
  const face = {
    box: { x: 100, y: 120, width: 240, height: 240 },
    landmarks: [
      [150, 200],
      [290, 200],
      [220, 240],
      [190, 280],
      [250, 280],
    ] as Array<[number, number]>,
    score: 0.95,
  };

  beforeEach(() => {
    compositeMock.mockReset();
    // 自动构图用例把 composite 换成 mock;质量检查依赖成片像素回调,
    // 因此这里按预设尺寸回调一份不透明像素。
    compositeMock.mockImplementation(async (...args: unknown[]) => {
      const width = args[2] as number;
      const height = args[3] as number;
      const capture = args[9] as
        | ((pixels: {
            rgba: Uint8ClampedArray;
            alpha: Uint8ClampedArray;
            width: number;
            height: number;
          }) => void)
        | undefined;
      capture?.({
        rgba: new Uint8ClampedArray(width * height * 4).fill(255),
        alpha: new Uint8ClampedArray(width * height).fill(255),
        width,
        height,
      });
      return new Blob(['ok'], { type: 'image/jpeg' });
    });
  });

  it('computes an auto layout on the first run', async () => {
    faceDetectMock.mockResolvedValue([face]);
    const { result } = renderHook(() => useLocalIdPhoto());

    await act(async () => {
      await result.current.process(makeFile('a.jpg'), 'balanced', {
        ...defaultOpts,
        autoFrame: true,
      });
    });

    expect(result.current.autoLayout).not.toBeNull();
    expect(result.current.userOverride).toBe(false);
    const passedCrop = compositeMock.mock.calls[0]![5] as {
      x: number;
      y: number;
      scale: number;
    };
    expect(passedCrop).toBeDefined();
    expect(passedCrop.scale).toBeGreaterThanOrEqual(1);
  });

  it('stops auto framing once the user overrides the crop', async () => {
    faceDetectMock.mockResolvedValue([face]);
    const { result } = renderHook(() => useLocalIdPhoto());

    act(() => result.current.markUserOverride());

    const manual = { x: 0.4, y: 0.3, scale: 1.5 };
    await act(async () => {
      await result.current.process(makeFile('a.jpg'), 'balanced', {
        ...defaultOpts,
        crop: manual,
        // 必须传 true,否则即使删掉 userOverride 守卫,检测也不会被调用,
        // 用例就无法验证「override 后停止自动构图」。
        autoFrame: true,
      });
    });

    expect(faceDetectMock).not.toHaveBeenCalled();
    expect(result.current.autoLayout).toBeNull();
    expect(compositeMock.mock.calls[0]![5]).toEqual(manual);
    // 手动模式下不做亮度校正,避免自动调色覆盖用户的画面判断。
    expect(compositeMock.mock.calls[0]![8]).toBe(0);
  });

  it('passes auto brightness mode only in auto mode', async () => {
    faceDetectMock.mockResolvedValue([]);
    const { result } = renderHook(() => useLocalIdPhoto());

    await act(async () => {
      await result.current.process(makeFile('a.jpg'), 'balanced', {
        ...defaultOpts,
        autoFrame: true,
      });
    });

    // 均值在 composite 内部按裁剪后的成片尺寸计算,与服务端同一口径。
    expect(compositeMock.mock.calls[0]![8]).toBe('auto');
  });

  it('passes zero brightness when auto framing is disabled', async () => {
    const { result } = renderHook(() => useLocalIdPhoto());

    await act(async () => {
      await result.current.process(makeFile('a.jpg'), 'balanced', defaultOpts);
    });

    expect(compositeMock.mock.calls[0]![8]).toBe(0);
  });

  it('falls back to the manual crop when no face is detected', async () => {
    faceDetectMock.mockResolvedValue([]);
    const { result } = renderHook(() => useLocalIdPhoto());

    const manual = { x: 0.5, y: 0.5, scale: 1 };
    await act(async () => {
      await result.current.process(makeFile('a.jpg'), 'balanced', {
        ...defaultOpts,
        crop: manual,
        autoFrame: true,
      });
    });

    expect(result.current.autoLayout).toBeNull();
    expect(result.current.status).toBe('done');
    expect(compositeMock.mock.calls[0]![5]).toEqual(manual);
  });

  it('passes the crown row scanned from the cutout RGBA to the layout', async () => {
    faceDetectMock.mockResolvedValue([face]);
    // cutout 10×10:第 1 行只有 2 个噪点像素(门槛 max(3, 0.2)=3),
    // 第 4 行起整行不透明 → crownY=4。RGB 全填 255:若误按单通道步长读,
    // 会把 RGB 当成 alpha 而得到 0。
    const OriginalCanvas = globalThis.OffscreenCanvas;
    class CrownCanvas extends (OriginalCanvas as unknown as new (
      w: number,
      h: number
    ) => { getContext(): { getImageData: unknown } }) {
      constructor(width: number, height: number) {
        super(width, height);
        const ctx = this.getContext();
        ctx.getImageData = (_x: number, _y: number, w: number, h: number) => {
          const data = new Uint8ClampedArray(w * h * 4).fill(255);
          for (let y = 0; y < h; y += 1) {
            for (let x = 0; x < w; x += 1) {
              const alpha = y >= 4 || (y === 1 && x < 2) ? 255 : 0;
              data[(y * w + x) * 4 + 3] = alpha;
            }
          }
          return { data };
        };
      }
    }
    Object.defineProperty(globalThis, 'OffscreenCanvas', {
      value: CrownCanvas,
      configurable: true,
      writable: true,
    });

    const { result } = renderHook(() => useLocalIdPhoto());
    await act(async () => {
      await result.current.process(makeFile('a.jpg'), 'balanced', {
        ...defaultOpts,
        autoFrame: true,
      });
    });

    expect(suggestLayoutMock).toHaveBeenCalledTimes(1);
    expect(suggestLayoutMock.mock.calls[0]![3]).toBe(4);
  });

  it('uses zero rotation when the layout rotation is not finite', async () => {
    faceDetectMock.mockResolvedValue([face]);
    suggestLayoutMock.mockImplementation((...args: unknown[]) => {
      const layout = actualValidators.suggestIdPhotoLayout!(...args) as {
        rotation: number;
      } | null;
      return layout ? { ...layout, rotation: Number.NaN } : layout;
    });
    const { result } = renderHook(() => useLocalIdPhoto());

    await act(async () => {
      await result.current.process(makeFile('a.jpg'), 'balanced', {
        ...defaultOpts,
        autoFrame: true,
      });
    });

    expect(result.current.status).toBe('done');
    // 传给 canvas 旋转的角度必须是 0,不能是 NaN。
    expect(compositeMock.mock.calls[0]![6]).toBe(0);
    // 旋转按 0 处理后人脸仍能映射到成片坐标。
    const centred = result.current.quality!.items.find(
      i => i.name === 'faceCentered'
    )!;
    expect(centred.value).toMatch(/^\d+%$/);
  });

  it('treats a face with non-finite landmarks as no face in the quality report', async () => {
    faceDetectMock.mockResolvedValue([
      {
        ...face,
        landmarks: [[Number.NaN, 200], ...face.landmarks.slice(1)],
      },
    ]);
    const { result } = renderHook(() => useLocalIdPhoto());

    await act(async () => {
      await result.current.process(makeFile('a.jpg'), 'balanced', {
        ...defaultOpts,
        autoFrame: true,
      });
    });

    const items = new Map(
      result.current.quality!.items.map(i => [i.name, i] as const)
    );
    // 检测到了一张脸,但映射不出有效坐标:数量照实报告,位置类按「未检测到」。
    expect(items.get('faceCount')!.value).toBe('1');
    for (const name of [
      'faceCentered',
      'faceRatio',
      'eyeTilt',
      'headroom',
    ] as const) {
      expect(items.get(name)!.value).toBe('—');
      expect(items.get(name)!.passed).toBe(false);
      expect(items.get(name)!.hint).toBe('faceNotDetected');
    }
  });

  it('runs face detection on the segmentation source so coordinates share one space', async () => {
    faceDetectMock.mockResolvedValue([face]);
    lastCutout = { width: 1365, height: 2048, close: vi.fn() };
    lastSource = { width: 1365, height: 2048, close: vi.fn() };
    const { result } = renderHook(() => useLocalIdPhoto());

    await act(async () => {
      await result.current.process(makeFile('a.jpg'), 'balanced', {
        ...defaultOpts,
        autoFrame: true,
      });
    });

    // 人脸检测、crownY、suggestIdPhotoLayout 都必须用缩放后的源图尺寸。
    expect(faceDetectMock).toHaveBeenCalledWith(lastSource);
    expect(suggestLayoutMock.mock.calls[0]![1]).toEqual({
      width: 1365,
      height: 2048,
    });
  });

  it('produces a quality report after compositing', async () => {
    faceDetectMock.mockResolvedValue([face]);
    const { result } = renderHook(() => useLocalIdPhoto());

    await act(async () => {
      await result.current.process(makeFile('a.jpg'), 'balanced', {
        ...defaultOpts,
        autoFrame: true,
      });
    });

    expect(result.current.quality).not.toBeNull();
    expect(result.current.quality!.items.length).toBe(8);
  });

  it('resetAll clears autoLayout, userOverride and quality', async () => {
    const { result } = renderHook(() => useLocalIdPhoto());

    act(() => result.current.markUserOverride());
    act(() => result.current.resetAll());

    expect(result.current.userOverride).toBe(false);
    expect(result.current.autoLayout).toBeNull();
    expect(result.current.quality).toBeNull();
  });

  it('resetResult clears results but keeps the user override', async () => {
    const { result } = renderHook(() => useLocalIdPhoto());

    // 先跑一次处理拿到结果,再标记手动构图。
    await act(async () => {
      await result.current.process(makeFile(), 'balanced', defaultOpts);
    });
    act(() => result.current.markUserOverride());
    expect(result.current.status).toBe('done');
    expect(result.current.resultBlob).not.toBeNull();

    act(() => result.current.resetResult());

    // 切模式共用裁剪框:结果要清,但用户手动调过的构图不能被清,
    // 否则服务端会误判为「没调过」而重新自动构图。
    expect(result.current.userOverride).toBe(true);
    expect(result.current.status).toBe('idle');
    expect(result.current.resultBlob).toBeNull();
    expect(result.current.autoLayout).toBeNull();
    expect(result.current.quality).toBeNull();
  });
});
