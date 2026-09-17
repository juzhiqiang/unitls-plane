import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CAD_DEGRADATION_CODES,
  CAD_ERROR_CODES,
} from '@utils-plane/validators';
import en from '../../../../../../messages/en.json';
import zh from '../../../../../../messages/zh.json';

const pageSource = () =>
  readFileSync(
    join(process.cwd(), 'src/app/[locale]/(app)/pdf/to-cad/page.tsx'),
    'utf8'
  );

describe('PDF to CAD page', () => {
  it('starts from the contract defaults', () => {
    const source = pageSource();

    expect(source).toContain("useState<CadOutputFormat>('dxf')");
    expect(source).toContain("useState<CadUnit>('mm')");
    expect(source).toContain('useState(1)');
    expect(source).toContain("useState<CadLayerMode>('source')");
    expect(source).toContain('const [ocr, setOcr] = useState(false)');
    expect(source).toContain(
      'const [includeRasterUnderlay, setIncludeRasterUnderlay] = useState(false)'
    );
  });

  it('keeps DWG visible but disabled and never submits it', () => {
    const source = pageSource();
    const dwgButton = source.slice(
      source.indexOf("title={t('toCad.dwgUnavailable')}") - 120,
      source.indexOf("title={t('toCad.dwgUnavailable')}")
    );

    expect(dwgButton).toContain('disabled');
    expect(dwgButton).toContain('aria-disabled="true"');
    expect(source).toContain("format === 'dxf' &&");
    expect(source).not.toContain("setFormat('dwg')");
  });

  it('submits a pdf_to_cad task with every contract option', () => {
    const source = pageSource();
    const submit = source.slice(source.indexOf('const handleConvert'));

    expect(submit).toContain("requireLogin('/pdf/to-cad')");
    expect(submit).toContain("type: 'pdf_to_cad'");
    for (const key of [
      'format,',
      'unit,',
      'scale,',
      'ocr,',
      'includeRasterUnderlay,',
      'layerMode,',
    ]) {
      expect(submit).toContain(key);
    }
    // 页码与 pdf_to_image 一致使用 0 基索引。
    expect(submit).toContain('.map(p => p - 1)');
  });

  it('reads conversion metadata from the task and names the download by output kind', () => {
    const source = pageSource();

    expect(source).toContain("api.GET('/tasks/{id}'");
    expect(source).toContain('pdfToCadConversionMetaSchema.safeParse');
    expect(source).toContain("archived ? 'zip' : 'dxf'");
    expect(source).toContain("t('toCad.resultZipHint')");
    expect(source).toContain("t('toCad.statEntities')");
    expect(source).toContain("t('toCad.statOcrText')");
    expect(source).toContain('toCad.degradations.${item.code}');
  });

  it('maps every contract error code and degradation code to copy in both locales', () => {
    const source = pageSource();
    expect(source).toContain('t(`toCad.errors.${err.code}`)');
    expect(source).toContain('errorCode={error.code}');

    for (const messages of [zh, en]) {
      const page = messages.PdfTool.toCad as {
        errors: Record<string, string>;
        degradations: Record<string, string>;
      };
      for (const code of CAD_ERROR_CODES) {
        expect(page.errors[code]).toBeTruthy();
      }
      for (const code of CAD_DEGRADATION_CODES) {
        expect(page.degradations[code]).toBeTruthy();
      }
      expect(messages.ToolCatalog.tools.pdfToCad.title).toBeTruthy();
      expect(messages.TasksTool.typePdfToCad).toBeTruthy();
      expect(messages.Dashboard.taskTypes.pdf_to_cad).toBeTruthy();
    }
  });

  it('shows stage labels that follow the processor progress ranges', () => {
    const source = pageSource();
    const stageFn = source.slice(
      source.indexOf('function stageForProgress'),
      source.indexOf('const OPTION_BUTTON')
    );
    expect(stageFn).toContain("if (progress < 50) return 'stageParse'");
    expect(stageFn).toContain("if (progress < 80) return 'stageOcr'");
    expect(stageFn).toContain("if (progress < 90) return 'stageWrite'");
    expect(stageFn).toContain("return 'stageUpload'");
  });
});
