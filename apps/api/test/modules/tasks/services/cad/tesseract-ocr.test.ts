import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import {
  checkTesseract,
  joinOcrWords,
  ocrLinesToEntities,
  parseTesseractTsv,
  resolveOcrLanguages,
  TesseractOcr,
  type OcrRunner,
} from '../../../../../src/modules/tasks/services/cad/tesseract-ocr';
import {
  loadMupdf,
  PdfCadExtractorService,
} from '../../../../../src/modules/tasks/services/cad/pdf-cad-extractor.service';
import { renderPageRaster } from '../../../../../src/modules/tasks/services/cad/raster-underlay';
import { CadError } from '../../../../../src/modules/tasks/services/cad/types';
import { DEFAULT_PDF_TO_CAD_CONFIG } from '@utils-plane/validators';
import {
  createChineseAnnotationFixture,
  createScannedFixture,
} from './fixtures';

const MM = 25.4 / 72;

const SAMPLE_TSV = [
  'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
  '1\t1\t0\t0\t0\t0\t0\t0\t800\t600\t-1\t',
  '2\t1\t1\t0\t0\t0\t320\t160\t250\t50\t-1\t',
  '3\t1\t1\t1\t0\t0\t320\t160\t250\t50\t-1\t',
  '4\t1\t1\t1\t1\t0\t320\t160\t250\t50\t-1\t',
  '5\t1\t1\t1\t1\t1\t320\t162\t120\t48\t95.5\tSCAN',
  '5\t1\t1\t1\t1\t2\t470\t162\t100\t48\t91.0\t123',
  '4\t1\t2\t1\t1\t0\t100\t400\t160\t40\t-1\t',
  '5\t1\t2\t1\t1\t1\t100\t400\t80\t40\t88\t尺寸',
  '5\t1\t2\t1\t1\t2\t180\t400\t80\t40\t86\t标注',
  '5\t1\t3\t1\t1\t1\t10\t10\t20\t20\t12\tnoise',
  '5\t1\t3\t1\t1\t2\t40\t10\t20\t20\t-1\t',
].join('\n');

function fakeRunner(
  overrides: Partial<Record<'version' | 'langs' | 'ocr', string>> = {}
): {
  runner: OcrRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  const runner: OcrRunner = async (_command, args) => {
    calls.push(args);
    if (args[0] === '--version') {
      return {
        stdout: overrides.version ?? 'tesseract 5.5.3\n leptonica-1.87.0\n',
      };
    }
    if (args[0] === '--list-langs') {
      return {
        stdout:
          overrides.langs ??
          'List of available languages in "/usr/share/tessdata/" (2):\nchi_sim\neng\n',
      };
    }
    return { stdout: overrides.ocr ?? SAMPLE_TSV };
  };
  return { runner, calls };
}

describe('parseTesseractTsv', () => {
  it('groups words into lines, keeps the line box and drops low-confidence noise', () => {
    const lines = parseTesseractTsv(SAMPLE_TSV);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      text: 'SCAN 123',
      left: 320,
      top: 160,
      width: 250,
      height: 50,
    });
    expect(lines[0]!.confidence).toBeCloseTo(93.25, 5);
    expect(lines[1]!.text).toBe('尺寸标注');
  });

  it('joins CJK words without spaces and Latin words with spaces', () => {
    expect(joinOcrWords(['尺寸', '标注', 'A1', '直径', '50'])).toBe(
      '尺寸标注 A1 直径 50'
    );
    expect(joinOcrWords(['', 'x'])).toBe('x');
  });

  it('returns nothing for empty or malformed output', () => {
    expect(parseTesseractTsv('')).toEqual([]);
    expect(parseTesseractTsv('foo\tbar\n1\t2\n')).toEqual([]);
  });
});

describe('TesseractOcr availability', () => {
  it('reports the executable as unavailable when it cannot be started', async () => {
    const status = await checkTesseract(async () => {
      const error = new Error('spawn tesseract ENOENT') as Error & {
        code: string;
      };
      error.code = 'ENOENT';
      throw error;
    });
    expect(status.available).toBe(false);
    expect(status.reason).toContain('ENOENT');
  });

  it('throws CAD_OCR_UNAVAILABLE when the executable is missing', async () => {
    const ocr = new TesseractOcr({
      runner: async () => {
        throw new Error('spawn tesseract ENOENT');
      },
      environment: {},
    });
    let caught: unknown;
    try {
      await ocr.ensureAvailable();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CadError);
    expect((caught as CadError).code).toBe('CAD_OCR_UNAVAILABLE');
    expect((caught as CadError).retryable).toBe(false);
  });

  it('throws CAD_OCR_UNAVAILABLE when a required language pack is missing', async () => {
    const { runner } = fakeRunner({
      langs: 'List of available languages (1):\neng\n',
    });
    const ocr = new TesseractOcr({ runner, environment: {} });
    await expect(ocr.ensureAvailable()).rejects.toMatchObject({
      code: 'CAD_OCR_UNAVAILABLE',
      details: { missing: ['chi_sim'], installed: ['eng'] },
    });
  });

  it('honours TESSERACT_BIN and CAD_OCR_LANGUAGES from the environment', async () => {
    const { runner, calls } = fakeRunner();
    const ocr = new TesseractOcr({
      runner,
      environment: {
        TESSERACT_BIN: '/opt/tesseract/bin/tesseract',
        CAD_OCR_LANGUAGES: 'eng',
      },
    });
    const status = await ocr.ensureAvailable();
    expect(status.command).toBe('/opt/tesseract/bin/tesseract');
    expect(resolveOcrLanguages({ CAD_OCR_LANGUAGES: 'chi_tra+eng' })).toEqual([
      'chi_tra',
      'eng',
    ]);
    expect(resolveOcrLanguages({})).toEqual(['chi_sim', 'eng']);
    expect(calls[0]).toEqual(['--version']);
  });
});

describe('TesseractOcr.recognize', () => {
  it('writes the PNG to a temp file, runs tesseract in TSV mode and parses the lines', async () => {
    const { runner, calls } = fakeRunner();
    let inputExisted = false;
    const spyRunner: OcrRunner = async (command, args, options) => {
      if (args[args.length - 1] === 'tsv') {
        inputExisted = (await readFile(args[0]!)).equals(
          Buffer.from('PNG-BYTES')
        );
      }
      return runner(command, args, options);
    };
    const ocr = new TesseractOcr({
      runner: spyRunner,
      environment: {},
      psm: 6,
    });
    const lines = await ocr.recognize(Buffer.from('PNG-BYTES'));
    expect(inputExisted).toBe(true);
    expect(lines.map(line => line.text)).toEqual(['SCAN 123', '尺寸标注']);
    const ocrCall = calls.find(args => args[args.length - 1] === 'tsv')!;
    expect(ocrCall.slice(1)).toEqual([
      'stdout',
      '-l',
      'chi_sim+eng',
      '--psm',
      '6',
      'tsv',
    ]);
    expect(ocrCall[0]).toMatch(/page\.png$/);
  });

  it('maps OCR pixel boxes to bottom-left CAD coordinates with ocr provenance', async () => {
    const fixture = await createScannedFixture();
    const document = await new PdfCadExtractorService().extract(
      fixture.pdf,
      DEFAULT_PDF_TO_CAD_CONFIG
    );
    const entities = ocrLinesToEntities(
      parseTesseractTsv(SAMPLE_TSV),
      document.pages[0]!,
      { dpi: 144 },
      MM,
      'OCR_TEXT',
      'Standard'
    );
    expect(entities).toHaveLength(2);
    expect(entities[0]).toMatchObject({
      type: 'text',
      source: 'ocr',
      origin: 'ocr',
      layer: 'OCR_TEXT',
      text: 'SCAN 123',
      rotation: 0,
    });
    // 144 DPI:1px = 0.5pt;左 320px → 160pt;基线 160 + 50×0.85 = 202.5px → 101.25pt → 自下 198.75pt。
    expect(entities[0]!.insert.x).toBeCloseTo(160 * MM, 3);
    expect(entities[0]!.insert.y).toBeCloseTo((300 - 101.25) * MM, 3);
    expect(entities[0]!.height).toBeCloseTo(25 * 0.75 * MM, 3);
  });
});

const realTesseract = await checkTesseract();

describe('Tesseract integration', () => {
  it.skipIf(
    !realTesseract.available || !realTesseract.languages?.includes('chi_sim')
  )(
    'recognizes Latin and Chinese text from MuPDF-rendered pages',
    async () => {
      const mupdf = await loadMupdf();
      // 整套测试并发跑时 Tesseract 偶发初始化抖动:识别失败重试一次再断言。
      const ocr = new TesseractOcr({ timeoutMs: 120_000 });
      const recognize = async (pdf: Buffer) => {
        const source = mupdf.Document.openDocument(pdf, 'application/pdf');
        try {
          const page = source.loadPage(0);
          try {
            return await ocr.recognize(renderPageRaster(mupdf, page, 300).png);
          } finally {
            page.destroy();
          }
        } finally {
          source.destroy();
        }
      };
      const recognizeWithRetry = async (pdf: Buffer) => {
        try {
          return await recognize(pdf);
        } catch {
          return await recognize(pdf);
        }
      };

      const scanned = await recognizeWithRetry(
        (await createScannedFixture()).pdf
      );
      expect(
        scanned.map(line => line.text.replace(/\s+/g, '')).join('|')
      ).toContain('SCAN123');

      const chinese = await recognizeWithRetry(
        (await createChineseAnnotationFixture()).pdf
      );
      const joined = chinese.map(line => line.text).join('|');
      expect(joined).toContain('尺寸');
      expect(joined).toContain('中文');
    },
    60_000
  );
});
