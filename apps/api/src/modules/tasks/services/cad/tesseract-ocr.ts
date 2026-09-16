import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { applyMatrix, pageToCadMatrix, round, roundPoint } from './geometry';
import { CadError, type CadPage, type CadTextEntity } from './types';

/**
 * Tesseract OCR 适配(02 契约)。
 *
 * 通过命令行调用 `tesseract`(镜像内安装 tesseract-ocr + chi_sim/eng 语言包;宿主机可用
 * `TESSERACT_BIN` 指定路径)。可执行文件不存在、无法启动或缺少所需语言包时抛
 * `CAD_OCR_UNAVAILABLE` —— 契约要求不得静默跳过 OCR。
 *
 * 识别结果按 TSV 解析成带像素框的文字行,再由 `ocrLinesToEntities` 转成 `source: 'ocr'` 的
 * TEXT 实体,坐标走与原生实体相同的翻转/单位换算。
 */

const execFileAsync = promisify(execFile);

export type OcrRunner = (
  command: string,
  args: string[],
  options: { timeout: number; maxBuffer: number; windowsHide: boolean }
) => Promise<{ stdout: string; stderr?: string }>;

export interface TesseractEnvironment {
  TESSERACT_BIN?: string;
  CAD_OCR_LANGUAGES?: string;
  CAD_OCR_PSM?: string;
}

export interface TesseractOptions {
  languages?: string[];
  /** 页面分割模式;缺省 11(稀疏文字),工程图上的零散标注比默认的整页版面分析更稳。 */
  psm?: number;
  /** 低于该置信度(0-100)的词丢弃。 */
  minConfidence?: number;
  timeoutMs?: number;
  runner?: OcrRunner;
  environment?: TesseractEnvironment;
}

export interface OcrWord {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  confidence: number;
}

export interface OcrLine {
  text: string;
  /** 像素框(左上原点),来自渲染位图。 */
  left: number;
  top: number;
  width: number;
  height: number;
  /** 行内词置信度平均值。 */
  confidence: number;
  words: OcrWord[];
}

export const DEFAULT_OCR_LANGUAGES = ['chi_sim', 'eng'];
export const DEFAULT_OCR_PSM = 11;
export const DEFAULT_OCR_MIN_CONFIDENCE = 30;
export const OCR_TIMEOUT_MS = 180_000;
/** OCR 文字高度 = 行框高 × 该比例(行框含升降部)。 */
export const OCR_TEXT_HEIGHT_RATIO = 0.75;

const defaultRunner: OcrRunner = (command, args, options) =>
  execFileAsync(command, args, options);

export function getTesseractCandidates(
  environment: TesseractEnvironment = process.env as TesseractEnvironment
): string[] {
  const configured = environment.TESSERACT_BIN?.trim();
  return [...new Set([configured, 'tesseract'].filter(Boolean))] as string[];
}

export function resolveOcrLanguages(
  environment: TesseractEnvironment = process.env as TesseractEnvironment,
  requested?: string[]
): string[] {
  if (requested && requested.length > 0) return requested;
  const configured = environment.CAD_OCR_LANGUAGES?.split(/[+,\s]+/)
    .map(value => value.trim())
    .filter(value => /^[a-z_]+$/i.test(value));
  return configured && configured.length > 0
    ? configured
    : DEFAULT_OCR_LANGUAGES;
}

export interface TesseractStatus {
  available: boolean;
  command?: string;
  version?: string;
  languages?: string[];
  reason?: string;
}

/**
 * 探测可执行文件与语言包。`/health/ready` 与任务前置检查共用。
 */
export async function checkTesseract(
  runner: OcrRunner = defaultRunner,
  environment: TesseractEnvironment = process.env as TesseractEnvironment
): Promise<TesseractStatus> {
  let lastError = 'tesseract executable not found';
  for (const command of getTesseractCandidates(environment)) {
    try {
      const version = await runner(command, ['--version'], {
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      });
      const versionLine =
        `${version.stdout}\n${version.stderr ?? ''}`
          .split(/\r?\n/)
          .find(line => /tesseract/i.test(line))
          ?.trim() ?? 'tesseract';
      const list = await runner(command, ['--list-langs'], {
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      });
      const languages = `${list.stdout}\n${list.stderr ?? ''}`
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => /^[a-z_]+$/i.test(line) && !/^list/i.test(line));
      return { available: true, command, version: versionLine, languages };
    } catch (error) {
      lastError = (error as Error).message;
    }
  }
  return { available: false, reason: lastError };
}

export class TesseractOcr {
  private readonly runner: OcrRunner;
  private readonly environment: TesseractEnvironment;
  private readonly languages: string[];
  private readonly psm: number;
  private readonly minConfidence: number;
  private readonly timeoutMs: number;
  private command: string | null = null;

  constructor(options: TesseractOptions = {}) {
    this.runner = options.runner ?? defaultRunner;
    this.environment =
      options.environment ?? (process.env as TesseractEnvironment);
    this.languages = resolveOcrLanguages(this.environment, options.languages);
    const envPsm = Number(this.environment.CAD_OCR_PSM);
    this.psm =
      options.psm ??
      (Number.isInteger(envPsm) && envPsm >= 0 && envPsm <= 13
        ? envPsm
        : DEFAULT_OCR_PSM);
    this.minConfidence = options.minConfidence ?? DEFAULT_OCR_MIN_CONFIDENCE;
    this.timeoutMs = options.timeoutMs ?? OCR_TIMEOUT_MS;
  }

  /** 确认 tesseract 可用且带有所需语言包;失败即 CAD_OCR_UNAVAILABLE。 */
  async ensureAvailable(): Promise<TesseractStatus> {
    const status = await checkTesseract(this.runner, this.environment);
    if (!status.available || !status.command) {
      throw new CadError(
        'CAD_OCR_UNAVAILABLE',
        `Tesseract OCR is not available: ${status.reason ?? 'unknown error'}`
      );
    }
    const missing = this.languages.filter(
      language => !(status.languages ?? []).includes(language)
    );
    if (missing.length > 0 && (status.languages ?? []).length > 0) {
      throw new CadError(
        'CAD_OCR_UNAVAILABLE',
        `Tesseract language data missing: ${missing.join(', ')}`,
        { missing, installed: status.languages }
      );
    }
    this.command = status.command;
    return status;
  }

  /** 识别一张 PNG,返回按行组织的结果(像素坐标)。 */
  async recognize(png: Buffer): Promise<OcrLine[]> {
    if (!this.command) await this.ensureAvailable();
    const directory = await mkdtemp(join(tmpdir(), 'utils-plane-ocr-'));
    const inputPath = join(directory, 'page.png');
    try {
      await writeFile(inputPath, png);
      const { stdout } = await this.runner(
        this.command!,
        [
          inputPath,
          'stdout',
          '-l',
          this.languages.join('+'),
          '--psm',
          String(this.psm),
          'tsv',
        ],
        {
          timeout: this.timeoutMs,
          maxBuffer: 64 * 1024 * 1024,
          windowsHide: true,
        }
      );
      return parseTesseractTsv(stdout, this.minConfidence);
    } catch (error) {
      if (error instanceof CadError) throw error;
      throw new CadError(
        'CAD_OCR_UNAVAILABLE',
        `Tesseract OCR failed: ${(error as Error).message}`
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

const CJK = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/;

/** 相邻两个词只有在两侧都不是 CJK 时才补空格:chi_sim 常把每个汉字当一个词。 */
export function joinOcrWords(words: string[]): string {
  let text = '';
  for (const word of words) {
    if (word.length === 0) continue;
    if (text.length === 0) {
      text = word;
      continue;
    }
    const last = text[text.length - 1]!;
    const first = word[0]!;
    text += CJK.test(last) && CJK.test(first) ? word : ` ${word}`;
  }
  return text;
}

/**
 * 解析 `tesseract ... tsv` 输出。level 5 是词,按 block/par/line 归组;
 * level 4 的行框优先作为行的几何,缺失时取词框并集。
 */
export function parseTesseractTsv(
  tsv: string,
  minConfidence = DEFAULT_OCR_MIN_CONFIDENCE
): OcrLine[] {
  const rows = tsv.split(/\r?\n/).filter(line => line.length > 0);
  if (rows.length === 0) return [];
  const header = rows[0]!.split('\t');
  const column = (name: string) => header.indexOf(name);
  const levelIndex = column('level');
  const pageIndex = column('page_num');
  const blockIndex = column('block_num');
  const parIndex = column('par_num');
  const lineIndex = column('line_num');
  const leftIndex = column('left');
  const topIndex = column('top');
  const widthIndex = column('width');
  const heightIndex = column('height');
  const confIndex = column('conf');
  const textIndex = column('text');
  if (
    [levelIndex, leftIndex, topIndex, widthIndex, heightIndex, textIndex].some(
      i => i < 0
    )
  ) {
    return [];
  }

  interface Group {
    box?: { left: number; top: number; width: number; height: number };
    words: OcrWord[];
  }
  const groups = new Map<string, Group>();
  const order: string[] = [];
  for (const row of rows.slice(1)) {
    const cells = row.split('\t');
    const level = Number(cells[levelIndex]);
    const key = [
      cells[pageIndex],
      cells[blockIndex],
      cells[parIndex],
      cells[lineIndex],
    ].join(':');
    if (!groups.has(key)) {
      groups.set(key, { words: [] });
      order.push(key);
    }
    const group = groups.get(key)!;
    const box = {
      left: Number(cells[leftIndex]),
      top: Number(cells[topIndex]),
      width: Number(cells[widthIndex]),
      height: Number(cells[heightIndex]),
    };
    if (level === 4) {
      group.box = box;
      continue;
    }
    if (level !== 5) continue;
    const text = (cells[textIndex] ?? '').trim();
    const confidence = Number(cells[confIndex]);
    if (
      text.length === 0 ||
      !Number.isFinite(confidence) ||
      confidence < minConfidence
    )
      continue;
    if (!(box.width > 0 && box.height > 0)) continue;
    group.words.push({ text, ...box, confidence });
  }

  const lines: OcrLine[] = [];
  for (const key of order) {
    const group = groups.get(key)!;
    if (group.words.length === 0) continue;
    const left = Math.min(...group.words.map(word => word.left));
    const top = Math.min(...group.words.map(word => word.top));
    const right = Math.max(...group.words.map(word => word.left + word.width));
    const bottom = Math.max(...group.words.map(word => word.top + word.height));
    const box = group.box ?? {
      left,
      top,
      width: right - left,
      height: bottom - top,
    };
    lines.push({
      text: joinOcrWords(group.words.map(word => word.text)),
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
      confidence:
        group.words.reduce((sum, word) => sum + word.confidence, 0) /
        group.words.length,
      words: group.words,
    });
  }
  return lines;
}

/** OCR 行 → 页内 CAD TEXT 实体(`source: 'ocr'`)。 */
export function ocrLinesToEntities(
  lines: OcrLine[],
  page: CadPage,
  raster: { dpi: number },
  unitFactor: number,
  layer: string,
  style: string
): CadTextEntity[] {
  const pointPerPixel = 72 / raster.dpi;
  const toCad = pageToCadMatrix(page.heightPt, unitFactor, 1);
  return lines.map(line => {
    const baselinePx = line.top + line.height * 0.85;
    return {
      type: 'text',
      layer,
      source: 'ocr',
      origin: 'ocr',
      text: line.text,
      insert: roundPoint(
        applyMatrix(
          toCad,
          line.left * pointPerPixel,
          baselinePx * pointPerPixel
        )
      ),
      height: round(
        line.height * pointPerPixel * OCR_TEXT_HEIGHT_RATIO * unitFactor
      ),
      rotation: 0,
      style,
    };
  });
}
