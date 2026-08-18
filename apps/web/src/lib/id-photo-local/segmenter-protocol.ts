export type SegmenterEp = 'webgpu' | 'wasm';

export type SegmenterRequest =
  | {
      type: 'init';
      modelUrl: string;
      mean: readonly [number, number, number];
      std: readonly [number, number, number];
      /** 模型量化方式:q4f16 含 MatMulNBits 算子,WebGPU EP 不支持 → worker 需强制 wasm。 */
      quant: 'fp16' | 'q4f16';
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
