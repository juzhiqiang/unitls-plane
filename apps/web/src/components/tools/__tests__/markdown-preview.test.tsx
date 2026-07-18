import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownPreview } from '../markdown-preview';
import { PdfResultPreview } from '../pdf-result-preview';

const pdfClientMocks = vi.hoisted(() => ({
  loadPdf: vi.fn(),
  renderPdfPage: vi.fn(),
}));

vi.mock('@/lib/processing/pdf-client', () => pdfClientMocks);

interface MockPdf {
  numPages: number;
  destroy: ReturnType<typeof vi.fn>;
}

function createPdf(numPages: number): MockPdf {
  return { numPages, destroy: vi.fn(async () => undefined) };
}

function createCanvas(
  pageNumber: number,
  targetCanvas?: HTMLCanvasElement,
  prefix = 'page'
) {
  const canvas = targetCanvas ?? document.createElement('canvas');
  Object.defineProperties(canvas, {
    width: { configurable: true, value: 600 },
    height: { configurable: true, value: 840 },
    toDataURL: {
      configurable: true,
      value: () => `data:image/png;base64,${prefix}-${pageNumber}`,
    },
  });
  return canvas;
}

function createFile(name = 'result.pdf') {
  return new File(['%PDF-1.7'], name, { type: 'application/pdf' });
}

function renderPdfPreview(file = createFile()) {
  return render(
    <PdfResultPreview
      file={file}
      label="result.pdf"
      previousLabel="上一页"
      nextLabel="下一页"
      pageIndicator={(page, total) => `第 ${page} / ${total} 页`}
      thumbnailLabel={page => `第 ${page} 页缩略图`}
      loadingLabel="加载中"
    />
  );
}

beforeEach(() => {
  pdfClientMocks.loadPdf.mockReset();
  pdfClientMocks.renderPdfPage.mockReset();

  const pdf = createPdf(3);
  pdfClientMocks.loadPdf.mockResolvedValue(pdf);
  pdfClientMocks.renderPdfPage.mockImplementation(
    async (
      _pdf: MockPdf,
      pageNumber: number,
      _scale: number,
      targetCanvas?: HTMLCanvasElement
    ) => createCanvas(pageNumber, targetCanvas)
  );
});

describe('MarkdownPreview', () => {
  it('accepts layout classes for roomy document workbenches', () => {
    render(
      <MarkdownPreview
        content="# Title"
        format="markdown"
        className="min-h-[604px]"
        viewportClassName="min-h-[560px]"
      />
    );

    expect(screen.getByText('Title').closest('.min-h-\\[604px\\]')).not.toBe(
      null
    );
    expect(screen.getByText('Title').closest('.min-h-\\[560px\\]')).not.toBe(
      null
    );
  });
});

describe('PdfResultPreview', () => {
  it('renders three thumbnails and navigates the selected page', async () => {
    renderPdfPreview();

    const firstThumbnail = await screen.findByRole('button', {
      name: '第 1 页缩略图',
    });
    expect(screen.getAllByRole('button', { name: /页缩略图$/ })).toHaveLength(
      3
    );
    expect(screen.getByText('第 1 / 3 页')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '下一页' })).toBeEnabled();
    expect(firstThumbnail).toHaveAttribute('aria-current', 'page');
    expect(within(firstThumbnail).getByRole('img')).toHaveAttribute(
      'src',
      'data:image/png;base64,page-1'
    );
    expect(screen.getByRole('img', { name: '第 1 / 3 页' })).toHaveAttribute(
      'src',
      'data:image/png;base64,page-1'
    );
    expect(pdfClientMocks.renderPdfPage).toHaveBeenCalledWith(
      expect.anything(),
      1,
      0.7
    );
    expect(pdfClientMocks.renderPdfPage).toHaveBeenCalledWith(
      expect.anything(),
      1,
      0.2
    );

    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => {
      expect(screen.getByText('第 2 / 3 页')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '第 3 页缩略图' }));
    await waitFor(() => {
      expect(screen.getByText('第 3 / 3 页')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled();
      expect(
        screen.getByRole('button', { name: '第 3 页缩略图' })
      ).toHaveAttribute('aria-current', 'page');
      expect(screen.getByRole('img', { name: '第 3 / 3 页' })).toHaveAttribute(
        'src',
        'data:image/png;base64,page-3'
      );
    });
  });

  it('disables both navigation controls for a single-page PDF', async () => {
    pdfClientMocks.loadPdf.mockResolvedValue(createPdf(1));

    renderPdfPreview();

    await screen.findByRole('button', { name: '第 1 页缩略图' });
    expect(screen.getAllByRole('button', { name: /页缩略图$/ })).toHaveLength(
      1
    );
    expect(screen.getByText('第 1 / 1 页')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled();
  });

  it('keeps thumbnail images naturally sized and fully contained', async () => {
    renderPdfPreview();

    const thumbnail = await screen.findByRole('button', {
      name: '第 1 页缩略图',
    });
    const image = within(thumbnail).getByRole('img');

    expect(image).toHaveClass(
      'h-auto',
      'max-w-full',
      'w-auto',
      'object-contain'
    );
    expect(image).not.toHaveClass('aspect-square');
    expect(image).not.toHaveClass('object-cover');
  });

  it('destroys replaced and unmounted PDFs without accepting stale renders', async () => {
    const oldPdf = createPdf(2);
    const newPdf = createPdf(2);
    let resolveOldMain: ((canvas: HTMLCanvasElement) => void) | undefined;
    const oldMainRender = new Promise<HTMLCanvasElement>(resolve => {
      resolveOldMain = resolve;
    });
    let resolveOldThumbnail: ((canvas: HTMLCanvasElement) => void) | undefined;
    const oldThumbnailRender = new Promise<HTMLCanvasElement>(resolve => {
      resolveOldThumbnail = resolve;
    });
    const oldFile = createFile('old.pdf');
    const newFile = createFile('new.pdf');

    pdfClientMocks.loadPdf.mockImplementation(async (file: File) =>
      file.name === oldFile.name ? oldPdf : newPdf
    );
    pdfClientMocks.renderPdfPage.mockImplementation(
      async (
        pdf: MockPdf,
        pageNumber: number,
        _scale: number,
        targetCanvas?: HTMLCanvasElement
      ) => {
        if (pdf === oldPdf && pageNumber === 1 && _scale === 0.7) {
          return oldMainRender;
        }
        if (pdf === oldPdf && pageNumber === 2 && _scale === 0.2) {
          return oldThumbnailRender;
        }
        return createCanvas(pageNumber, targetCanvas, 'new-page');
      }
    );

    const { rerender, unmount } = renderPdfPreview(oldFile);
    await waitFor(() => {
      expect(pdfClientMocks.renderPdfPage).toHaveBeenCalledWith(oldPdf, 1, 0.7);
    });
    await act(async () => {
      resolveOldMain?.(createCanvas(1, undefined, 'old-page'));
      await oldMainRender;
    });
    await waitFor(() => {
      expect(pdfClientMocks.renderPdfPage).toHaveBeenCalledWith(oldPdf, 2, 0.2);
    });

    rerender(
      <PdfResultPreview
        file={newFile}
        label="result.pdf"
        previousLabel="上一页"
        nextLabel="下一页"
        pageIndicator={(page, total) => `第 ${page} / ${total} 页`}
        thumbnailLabel={page => `第 ${page} 页缩略图`}
        loadingLabel="加载中"
      />
    );

    await waitFor(() => {
      expect(oldPdf.destroy).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('img', { name: '第 1 / 2 页' })).toHaveAttribute(
        'src',
        'data:image/png;base64,new-page-1'
      );
    });

    await act(async () => {
      resolveOldThumbnail?.(createCanvas(2, undefined, 'old-page'));
      await oldThumbnailRender;
    });

    expect(screen.getByRole('img', { name: '第 1 / 2 页' })).toHaveAttribute(
      'src',
      'data:image/png;base64,new-page-1'
    );
    await waitFor(() => {
      expect(
        within(screen.getByRole('button', { name: '第 2 页缩略图' })).getByRole(
          'img'
        )
      ).toHaveAttribute('src', 'data:image/png;base64,new-page-2');
    });

    unmount();
    expect(newPdf.destroy).toHaveBeenCalledTimes(1);
  });

  it('limits thumbnail rendering to three concurrent pages and recovers from a failed thumbnail', async () => {
    const pdf = createPdf(6);
    let activeThumbnailRenders = 0;
    let maxThumbnailRenders = 0;

    pdfClientMocks.loadPdf.mockResolvedValue(pdf);
    pdfClientMocks.renderPdfPage.mockImplementation(
      async (
        _pdf: MockPdf,
        pageNumber: number,
        scale: number,
        targetCanvas?: HTMLCanvasElement
      ) => {
        if (scale === 0.2) {
          activeThumbnailRenders += 1;
          maxThumbnailRenders = Math.max(
            maxThumbnailRenders,
            activeThumbnailRenders
          );
          await new Promise(resolve => setTimeout(resolve, 0));
          activeThumbnailRenders -= 1;

          if (pageNumber === 2) {
            throw new Error('thumbnail rendering failed');
          }
        }

        return createCanvas(pageNumber, targetCanvas);
      }
    );

    renderPdfPreview();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /页缩略图$/ })).toHaveLength(
        6
      );
      expect(
        pdfClientMocks.renderPdfPage.mock.calls.filter(call => call[2] === 0.2)
      ).toHaveLength(6);
      expect(maxThumbnailRenders).toBeGreaterThan(0);
      expect(maxThumbnailRenders).toBeLessThanOrEqual(3);
      expect(
        within(screen.getByRole('button', { name: '第 1 页缩略图' })).getByRole(
          'img'
        )
      ).toHaveAttribute('src', 'data:image/png;base64,page-1');
      expect(
        within(screen.getByRole('button', { name: '第 3 页缩略图' })).getByRole(
          'img'
        )
      ).toHaveAttribute('src', 'data:image/png;base64,page-3');
      for (const page of [1, 3, 4, 5, 6]) {
        expect(
          within(
            screen.getByRole('button', { name: `第 ${page} 页缩略图` })
          ).getByRole('img')
        ).toHaveAttribute('src', `data:image/png;base64,page-${page}`);
      }
      expect(
        within(
          screen.getByRole('button', { name: '第 2 页缩略图' })
        ).queryByRole('img')
      ).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '第 2 页缩略图' }));
    await waitFor(() => {
      expect(screen.getByText('第 2 / 6 页')).toBeInTheDocument();
      expect(screen.getByRole('img', { name: '第 2 / 6 页' })).toHaveAttribute(
        'src',
        'data:image/png;base64,page-2'
      );
    });
  });
});
