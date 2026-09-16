import { describe, expect, it } from 'bun:test';
import { DEFAULT_PDF_TO_CAD_CONFIG } from '@utils-plane/validators';
import {
  loadMupdf,
  PdfCadExtractorService,
} from '../../../../../src/modules/tasks/services/cad/pdf-cad-extractor.service';
import {
  effectiveRasterDpi,
  inferRasterLines,
  rasterLinesToEntities,
  renderPageRaster,
  RASTER_MAX_EDGE_PX,
} from '../../../../../src/modules/tasks/services/cad/raster-underlay';
import { createScannedFixture, SCANNED_FIXTURE_PIXELS } from './fixtures';

const MM = 25.4 / 72;

function bitmap(
  width: number,
  height: number,
  paint: (x: number, y: number) => boolean
) {
  const pixels = new Uint8ClampedArray(width * height).fill(255);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (paint(x, y)) pixels[y * width + x] = 0;
    }
  }
  return { pixels, width, height };
}

describe('effectiveRasterDpi', () => {
  it('keeps the requested DPI for ordinary pages and caps the longest edge', () => {
    expect(effectiveRasterDpi(400, 300, 300)).toBe(300);
    // A0 横向 3370pt:300 DPI 会有 14042px,封顶到 RASTER_MAX_EDGE_PX。
    const capped = effectiveRasterDpi(3370, 2384, 300);
    expect((3370 * capped) / 72).toBeCloseTo(RASTER_MAX_EDGE_PX, 3);
  });
});

describe('inferRasterLines', () => {
  it('finds long thin horizontal and vertical ink bands and ignores glyph-sized runs', () => {
    const raster = bitmap(400, 200, (x, y) => {
      const horizontal = y >= 100 && y <= 102 && x >= 40 && x <= 360;
      const vertical = x >= 50 && x <= 52 && y >= 20 && y <= 180;
      const glyph = y >= 30 && y <= 45 && x >= 200 && x <= 215;
      const block = x >= 300 && x <= 380 && y >= 20 && y <= 80;
      return horizontal || vertical || glyph || block;
    });
    const lines = inferRasterLines(raster, {
      minLengthPx: 100,
      maxThicknessPx: 6,
    });
    expect(lines.map(line => line.orientation).sort()).toEqual([
      'horizontal',
      'vertical',
    ]);
    const horizontal = lines.find(line => line.orientation === 'horizontal')!;
    expect(horizontal).toMatchObject({
      x1: 40,
      x2: 360,
      y1: 101,
      y2: 101,
      thicknessPx: 3,
    });
    const vertical = lines.find(line => line.orientation === 'vertical')!;
    expect(vertical).toMatchObject({
      x1: 51,
      x2: 51,
      y1: 20,
      y2: 180,
      thicknessPx: 3,
    });
  });

  it('returns nothing for a blank bitmap', () => {
    expect(inferRasterLines(bitmap(100, 100, () => false))).toEqual([]);
  });
});

describe('renderPageRaster', () => {
  it('rasterizes the scanned fixture at the requested DPI and recovers both ruled lines', async () => {
    const fixture = await createScannedFixture();
    const mupdf = await loadMupdf();
    const document = mupdf.Document.openDocument(
      fixture.pdf,
      'application/pdf'
    );
    try {
      const page = document.loadPage(0);
      try {
        const raster = renderPageRaster(mupdf, page, 144);
        expect(raster.dpi).toBe(144);
        expect(raster.width).toBe(SCANNED_FIXTURE_PIXELS.width);
        expect(raster.height).toBe(SCANNED_FIXTURE_PIXELS.height);
        expect(raster.png.subarray(0, 4)).toEqual(
          Buffer.from([0x89, 0x50, 0x4e, 0x47])
        );

        const lines = inferRasterLines(raster);
        expect(lines).toHaveLength(2);
        // 横线占像素行 297~302,中心 299.5;竖线占像素列 97~102,中心 99.5。
        const horizontal = lines.find(
          line => line.orientation === 'horizontal'
        )!;
        expect(horizontal.y1).toBeCloseTo(299.5, 1);
        expect(horizontal.x1).toBeCloseTo(60, -1);
        expect(horizontal.x2).toBeCloseTo(739, -1);
        const vertical = lines.find(line => line.orientation === 'vertical')!;
        expect(vertical.x1).toBeCloseTo(99.5, 1);
        expect(vertical.y1).toBeCloseTo(80, -1);
        expect(vertical.y2).toBeCloseTo(519, -1);

        const cadDocument = await new PdfCadExtractorService().extract(
          fixture.pdf,
          DEFAULT_PDF_TO_CAD_CONFIG
        );
        const entities = rasterLinesToEntities(
          lines,
          cadDocument.pages[0]!,
          raster,
          MM,
          'INFERRED_RASTER'
        );
        expect(entities).toHaveLength(2);
        expect(entities[0]).toMatchObject({
          type: 'line',
          source: 'inferred',
          origin: 'raster',
          layer: 'INFERRED_RASTER',
        });
        // 144 DPI 下 1px = 0.5pt;横线中心 y=299.5px → 149.75pt,自左下原点是 300 − 149.75 = 150.25pt。
        const horizontalEntity = entities.find(
          entity => entity.start.y === entity.end.y
        )!;
        expect(horizontalEntity.start.y).toBeCloseTo(150.25 * MM, 2);
        expect(horizontalEntity.start.x).toBeCloseTo(30 * MM, 1);
        expect(horizontalEntity.lineWeightMm).toBeCloseTo(6 * 0.5 * MM, 2);
      } finally {
        page.destroy();
      }
    } finally {
      document.destroy();
    }
  });
});
