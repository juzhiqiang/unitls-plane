import { currentResourceLimits } from '../../../../common/resources/task-resource-context';
import { TaskResourceLimitError } from '../../../../common/resources/resource-error';
import * as archiver from 'archiver';

export function streamToBuffer(archive: archiver.Archiver): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const maxBytes = currentResourceLimits().outputBytes;
    archive.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        archive.abort();
        archive.destroy();
        reject(new TaskResourceLimitError('ZIP output budget exceeded'));
        return;
      }
      chunks.push(chunk);
    });
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
    void archive.finalize().catch(reject);
  });
}

// archiver 运行时是 v8(ESM,只导出 ZipArchive 类),@types/archiver 仍是 v7 的 create() 形状:
// archiver.create 在运行时是 undefined,拆分多份 / 多页转图片的 ZIP 分支之前一直会抛
// TypeError。与 account-export.service、cad-writer 相同的取法。
const ZipArchive = (
  archiver as unknown as {
    ZipArchive: new (options: { zlib: { level: number } }) => archiver.Archiver;
  }
).ZipArchive;

export function createZipArchive(): archiver.Archiver {
  return new ZipArchive({ zlib: { level: 6 } });
}
