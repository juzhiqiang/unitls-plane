import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../../messages/en.json';

const zipState = vi.hoisted(() => ({
  imports: 0,
  instances: 0,
  entries: [] as Array<[string, File]>,
  generate: async () => new Blob(['zip']),
}));

vi.mock('jszip', () => {
  zipState.imports += 1;

  return {
    default: class MockJSZip {
      constructor() {
        zipState.instances += 1;
      }

      file(name: string, file: File) {
        zipState.entries.push([name, file]);
        return this;
      }

      generateAsync() {
        return zipState.generate();
      }
    },
  };
});

function createFile(name: string, content: string) {
  return new File([content], name, { type: 'text/plain' });
}

function renderButton(
  Component: ComponentType<{ files: File[] }>,
  files: File[]
) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <Component files={files} />
    </NextIntlClientProvider>
  );
}

describe('ZipDownloadButton', () => {
  beforeEach(() => {
    vi.resetModules();
    zipState.imports = 0;
    zipState.instances = 0;
    zipState.entries = [];
    zipState.generate = async () => new Blob(['zip']);
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:zip'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads JSZip only after the download is requested', async () => {
    const { ZipDownloadButton } =
      await import('@/components/tools/zip-download-button');
    const files = [createFile('same.txt', 'a'), createFile('same.txt', 'b')];

    renderButton(ZipDownloadButton, files);
    const button = screen.getByRole('button', {
      name: 'Download ZIP (2)',
    });

    expect(zipState.imports).toBe(0);
    expect(zipState.instances).toBe(0);

    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => expect(button).not.toBeDisabled());
    expect(zipState.imports).toBe(1);
    expect(zipState.instances).toBe(1);
    expect(zipState.entries.map(([name]) => name)).toEqual([
      'same.txt',
      'same-1.txt',
    ]);
    expect(zipState.entries[0]![1]).toBe(files[0]);
    expect(zipState.entries[1]![1]).toBe(files[1]);
  });

  it('restores the button after zip generation fails', async () => {
    zipState.generate = async () => {
      throw new Error('zip failed');
    };
    const { ZipDownloadButton } =
      await import('@/components/tools/zip-download-button');

    renderButton(ZipDownloadButton, [createFile('result.txt', 'a')]);
    const button = screen.getByRole('button', {
      name: 'Download ZIP (1)',
    });

    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => expect(button).not.toBeDisabled());
    expect(zipState.instances).toBe(1);
  });
});
