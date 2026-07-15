import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type LibreOfficeRunner = (
  command: string,
  args: string[],
  options: { timeout: number }
) => Promise<unknown>;

type LibreOfficeEnvironment = { LIBREOFFICE_BIN?: string };

const defaultRunner: LibreOfficeRunner = async (command, args, options) => {
  await execFileAsync(command, args, options);
};

export function getLibreOfficeCandidates(
  environment: LibreOfficeEnvironment = {
    LIBREOFFICE_BIN: process.env.LIBREOFFICE_BIN,
  }
): string[] {
  const configured = environment.LIBREOFFICE_BIN?.trim();
  return [
    ...new Set([configured, 'soffice', 'libreoffice'].filter(Boolean)),
  ] as string[];
}

export async function checkLibreOffice(
  runner: LibreOfficeRunner = defaultRunner,
  environment: LibreOfficeEnvironment = {
    LIBREOFFICE_BIN: process.env.LIBREOFFICE_BIN,
  }
): Promise<boolean> {
  for (const command of getLibreOfficeCandidates(environment)) {
    try {
      await runner(command, ['--version'], { timeout: 3000 });
      return true;
    } catch {
      // Try the next known executable name.
    }
  }

  return false;
}
