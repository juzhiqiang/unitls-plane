export type SegmenterEp = 'webgpu' | 'wasm';

export type SegmenterRequest =
  | {
      type: 'init';
      modelUrl: string;
      mean: readonly [number, number, number];
      std: readonly [number, number, number];
    }
  | { type: 'run'; bitmap: ImageBitmap; srcW: number; srcH: number };

export type SegmenterResponse =
  | { type: 'progress'; ratio: number }
  | {
      type: 'ready';
      ep: SegmenterEp;
      inputNames: readonly string[];
      outputNames: readonly string[];
    }
  | { type: 'result'; mask: Float32Array; maskW: number; maskH: number }
  | { type: 'error'; message: string };
