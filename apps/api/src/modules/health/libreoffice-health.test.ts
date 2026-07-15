import { describe, expect, it, vi } from 'bun:test';
import {
  checkLibreOffice,
  getLibreOfficeCandidates,
  type LibreOfficeRunner,
} from './libreoffice-health';

describe('getLibreOfficeCandidates', () => {
  it('prefers a trimmed environment command before default candidates', () => {
    expect(
      getLibreOfficeCandidates({ LIBREOFFICE_BIN: '  C:/Office/soffice.exe  ' })
    ).toEqual(['C:/Office/soffice.exe', 'soffice', 'libreoffice']);
  });

  it('ignores blank values and removes duplicate candidates', () => {
    expect(getLibreOfficeCandidates({ LIBREOFFICE_BIN: '   ' })).toEqual([
      'soffice',
      'libreoffice',
    ]);
    expect(getLibreOfficeCandidates({ LIBREOFFICE_BIN: ' soffice ' })).toEqual([
      'soffice',
      'libreoffice',
    ]);
  });
});

describe('checkLibreOffice', () => {
  it('checks candidates in order with execFile arguments and stops on success', async () => {
    const runner = vi
      .fn<LibreOfficeRunner>()
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce(undefined);

    await expect(
      checkLibreOffice(runner, { LIBREOFFICE_BIN: 'custom-office' })
    ).resolves.toBe(true);

    expect(runner.mock.calls).toEqual([
      ['custom-office', ['--version'], { timeout: 3000 }],
      ['soffice', ['--version'], { timeout: 3000 }],
    ]);
  });

  it('returns false after every candidate fails', async () => {
    const runner = vi.fn<LibreOfficeRunner>(async () => {
      throw new Error('unavailable');
    });

    await expect(checkLibreOffice(runner, {})).resolves.toBe(false);

    expect(runner).toHaveBeenCalledTimes(2);
  });

  it('treats an execFile timeout as an unavailable candidate', async () => {
    const timeout = Object.assign(new Error('timed out'), {
      code: 'ETIMEDOUT',
    });
    const runner = vi.fn<LibreOfficeRunner>(async () => {
      throw timeout;
    });

    await expect(
      checkLibreOffice(runner, { LIBREOFFICE_BIN: 'slow-office' })
    ).resolves.toBe(false);

    expect(runner).toHaveBeenCalledTimes(3);
    expect(runner.mock.calls[0]).toEqual([
      'slow-office',
      ['--version'],
      { timeout: 3000 },
    ]);
  });
});
