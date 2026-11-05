import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { BadRequestException } from '@nestjs/common';

const execFileAsync = promisify(execFile);

export function buildLibreOfficeArgs(
  sourcePath: string,
  outputDir: string,
  profileDir: string,
  filter: 'pdf:writer_pdf_Export' | 'pdf'
): string[] {
  return [
    `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
    '--headless',
    '--invisible',
    '--nodefault',
    '--nolockcheck',
    '--nologo',
    '--nofirststartwizard',
    '--convert-to',
    filter,
    '--outdir',
    outputDir,
    sourcePath,
  ];
}

export class LibreOfficeConverter {
  async convert(
    sourcePath: string,
    tempDir: string,
    filter: 'pdf:writer_pdf_Export' | 'pdf'
  ): Promise<string> {
    const outputDir = await mkdtemp(join(tempDir, 'libreoffice-output-'));
    const profileDir = await mkdtemp(join(tempDir, 'libreoffice-profile-'));
    const outputPath = join(
      outputDir,
      `${basename(sourcePath, extname(sourcePath))}.pdf`
    );
    const commands = process.env.LIBREOFFICE_BIN
      ? [process.env.LIBREOFFICE_BIN]
      : ['soffice', 'libreoffice'];

    for (const command of commands) {
      try {
        await rm(outputPath, { force: true });
        await execFileAsync(
          command,
          buildLibreOfficeArgs(sourcePath, outputDir, profileDir, filter),
          { timeout: 120_000, windowsHide: true }
        );

        await readFile(outputPath);
        return outputPath;
      } catch {
        // Continue with the next available LibreOffice executable.
      }
    }

    throw new BadRequestException(
      'LibreOffice is required for Markdown/Word to PDF conversion'
    );
  }
}
