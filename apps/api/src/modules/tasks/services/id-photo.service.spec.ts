import { describe, expect, it } from 'bun:test';
import sharp from 'sharp';
import { IdPhotoService } from './id-photo.service';

describe('IdPhotoService', () => {
  it('renders a JPEG with the selected preset size and background color', async () => {
    const input = await sharp({
      create: {
        width: 500,
        height: 700,
        channels: 3,
        background: '#dddddd',
      },
    })
      .jpeg()
      .toBuffer();

    const service = new IdPhotoService({
      segment: async () => ({
        mask: await sharp(Buffer.alloc(500 * 700, 255), {
          raw: {
            width: 500,
            height: 700,
            channels: 1,
          },
        })
          .png()
          .toBuffer(),
        bounds: { x: 100, y: 80, width: 300, height: 520 },
        faceCount: 1,
      }),
    } as any);

    const output = await service.render(input, {
      preset: 'one_inch',
      backgroundColor: '#ff0000',
      outputType: 'image/jpeg',
      dpi: 300,
    });

    const metadata = await sharp(output.buffer).metadata();
    expect(metadata.width).toBe(295);
    expect(metadata.height).toBe(413);
    expect(output.mimeType).toBe('image/jpeg');
    expect(output.extension).toBe('jpg');
  });

  it('throws NO_FACE_DETECTED when the segmentation service reports zero faces', async () => {
    const input = await sharp({
      create: {
        width: 300,
        height: 300,
        channels: 3,
        background: '#eeeeee',
      },
    })
      .png()
      .toBuffer();

    const service = new IdPhotoService({
      segment: async () => ({
        mask: Buffer.alloc(0),
        faceCount: 0,
      }),
    } as any);

    await expect(
      service.render(input, {
        preset: 'passport',
        backgroundColor: '#ffffff',
        outputType: 'image/png',
        dpi: 300,
      })
    ).rejects.toMatchObject({ code: 'NO_FACE_DETECTED' });
  });
});
