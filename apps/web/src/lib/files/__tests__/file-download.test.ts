import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from 'vitest';
import {
  buildFileDownloadUrl,
  downloadStoredFile,
  triggerBrowserDownload,
} from '../file-download';

const API_URL = 'https://api.example.com';
const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;

beforeAll(() => {
  process.env.NEXT_PUBLIC_API_URL = API_URL;
});

afterAll(() => {
  if (originalApiUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
  else process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
});

describe('buildFileDownloadUrl', () => {
  it('returns the inline preview url by default', () => {
    expect(buildFileDownloadUrl('file-1')).toBe(
      `${API_URL}/files/file-1/download`
    );
  });

  it('appends download=1 when an attachment is requested', () => {
    expect(buildFileDownloadUrl('file-1', { attachment: true })).toBe(
      `${API_URL}/files/file-1/download?download=1`
    );
  });
});

describe('triggerBrowserDownload', () => {
  let click: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    click = vi.spyOn(HTMLAnchorElement.prototype, 'click');
    click.mockImplementation(() => {});
  });

  afterEach(() => {
    click.mockRestore();
  });

  it('clicks a temporary anchor and cleans it up', () => {
    triggerBrowserDownload('http://example.com/a.png', 'a.png');

    expect(click).toHaveBeenCalledTimes(1);
    const anchor = click.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.getAttribute('href')).toBe('http://example.com/a.png');
    expect(anchor.download).toBe('a.png');
    expect(anchor.isConnected).toBe(false);
    expect(document.querySelector('a')).toBeNull();
  });

  it('downloads stored files as attachments', () => {
    downloadStoredFile('file-9', 'invoice.pdf');

    const anchor = click.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.getAttribute('href')).toBe(
      `${API_URL}/files/file-9/download?download=1`
    );
    expect(anchor.download).toBe('invoice.pdf');
  });
});
