import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';

export type PortraitMask = {
  mask: Buffer;
  bounds?: { x: number; y: number; width: number; height: number };
  faceCount?: number;
};

@Injectable()
export class PortraitSegmentationService {
  private sessionPromise?: Promise<ort.InferenceSession>;

  async segment(input: Buffer): Promise<PortraitMask> {
    const metadata = await sharp(input).metadata();
    if (!metadata.width || !metadata.height) {
      return { mask: Buffer.alloc(0), faceCount: 0 };
    }

    const session = await this.getSession();
    const size = 320;
    const raw = await sharp(input)
      .resize(size, size, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer();

    const tensorData = new Float32Array(1 * 3 * size * size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const pixel = (y * size + x) * 3;
        const target = y * size + x;
        tensorData[target] = (raw[pixel] ?? 0) / 255;
        tensorData[size * size + target] = (raw[pixel + 1] ?? 0) / 255;
        tensorData[2 * size * size + target] = (raw[pixel + 2] ?? 0) / 255;
      }
    }

    const inputName = session.inputNames[0];
    const outputName = session.outputNames[0];
    if (!inputName || !outputName) {
      return { mask: Buffer.alloc(0), faceCount: 0 };
    }
    const result = await session.run({
      [inputName]: new ort.Tensor('float32', tensorData, [1, 3, size, size]),
    });
    const output = result[outputName];
    if (!output) {
      return { mask: Buffer.alloc(0), faceCount: 0 };
    }
    const maskValues = output.data as Float32Array;
    const maskBytes = Buffer.alloc(size * size);
    for (let i = 0; i < maskBytes.length; i += 1) {
      maskBytes[i] = Math.max(
        0,
        Math.min(255, Math.round((maskValues[i] ?? 0) * 255))
      );
    }

    const mask = await sharp(maskBytes, {
      raw: { width: size, height: size, channels: 1 },
    })
      .resize(metadata.width, metadata.height, { fit: 'fill' })
      .png()
      .toBuffer();

    return {
      mask,
      bounds: { x: 0, y: 0, width: metadata.width, height: metadata.height },
      faceCount: 1,
    };
  }

  private getSession(): Promise<ort.InferenceSession> {
    if (!this.sessionPromise) {
      const modelPath =
        process.env.ID_PHOTO_SEGMENTATION_MODEL ??
        'apps/api/models/u2netp.onnx';
      this.sessionPromise = ort.InferenceSession.create(modelPath);
    }
    return this.sessionPromise;
  }
}
