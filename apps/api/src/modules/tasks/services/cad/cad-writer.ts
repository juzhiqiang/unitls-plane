import * as archiver from 'archiver';
import type { CadOutputFormat } from '@utils-plane/validators';
import { DxfWriter, type DxfWriterOptions } from './dxf-writer';
import { CadError, type CadWriteResult, type CadWriter } from './types';

// archiver 运行时是 v8(ESM,只导出 ZipArchive 类),@types/archiver 仍是 v7 的 create() 形状;
// 与 account-export.service 相同的取法,绕开类型与运行时不一致。
const ZipArchive = (
  archiver as unknown as {
    ZipArchive: new (options: { zlib: { level: number } }) => archiver.Archiver;
  }
).ZipArchive;

/**
 * CAD 写出器入口(02 契约)。
 *
 * writer 接口可替换:按输出格式挑选实现。DWG 目前只保留适配边界 ——
 * `DwgWriter.write()` 一定抛 `CAD_DWG_UNSUPPORTED`,绝不产出伪成功文件。
 */

export class DwgWriter implements CadWriter {
  readonly format = 'dwg' as const;

  async write(): Promise<CadWriteResult> {
    throw new CadError(
      'CAD_DWG_UNSUPPORTED',
      'DWG output is not available yet; export DXF instead'
    );
  }
}

export function createCadWriter(
  format: CadOutputFormat,
  options: DxfWriterOptions = {}
): CadWriter {
  switch (format) {
    case 'dxf':
      return new DxfWriter(options);
    case 'dwg':
      return new DwgWriter();
  }
}

export interface PackagedCadOutput {
  filename: string;
  mimeType: string;
  data: Buffer;
  /** 产物是否为 ZIP(带底图资源)。 */
  archived: boolean;
}

/**
 * 把写出结果打包成一个可上传的文件:只有主文件时直接返回 DXF;
 * 带底图等附属资源时打成 ZIP,DXF 与 PNG 同级放置,DXF 里的相对路径才能被 CAD 找到。
 */
export async function packageCadWriteResult(
  result: CadWriteResult
): Promise<PackagedCadOutput> {
  const primary = result.files.find(file => file.name === result.primary);
  if (!primary) {
    throw new CadError(
      'CAD_CONVERSION_FAILED',
      'Writer result is missing its primary file'
    );
  }
  if (result.files.length === 1) {
    return {
      filename: primary.name,
      mimeType: primary.mimeType,
      data: primary.data,
      archived: false,
    };
  }

  const archive = new ZipArchive({ zlib: { level: 6 } });
  const done = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
  });
  for (const file of result.files) {
    archive.append(file.data, { name: file.name });
  }
  await archive.finalize();
  const data = await done;
  return {
    filename: primary.name.replace(/\.dxf$/i, '') + '.zip',
    mimeType: 'application/zip',
    data,
    archived: true,
  };
}
