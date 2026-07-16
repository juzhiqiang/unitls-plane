import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '../../../../messages/en.json';
import { imageTools, recommendedTools } from '@/lib/tools/tool-metadata';
import { FailureRecoveryPanel } from '../failure-recovery-panel';
import { ModeToggle } from '../mode-toggle';
import { ResultPanel } from '../result-panel';
import { ToolCatalogGrid } from '../tool-catalog-grid';
import { ToolPageShell } from '../tool-page-shell';
import { ToolStepRail } from '../tool-step-rail';
import { ToolTrustStrip } from '../tool-trust-strip';

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      {ui}
    </NextIntlClientProvider>
  );
}

describe('tool experience components', () => {
  it('renders processing transparency without requiring color-only meaning', () => {
    renderWithIntl(
      <ToolTrustStrip
        processing="server"
        retention="account-files"
        requiresLogin
        recovery="Retry, replace file, or inspect task details."
      />
    );

    expect(screen.getByText('Server processing')).toBeInTheDocument();
    expect(screen.getByText('Sign-in required')).toBeInTheDocument();
    expect(screen.getByText('Saved to account files')).toBeInTheDocument();
    expect(screen.getByText(/Retry, replace file/)).toBeInTheDocument();
  });

  it('labels every workflow stage and marks the current stage', () => {
    renderWithIntl(<ToolStepRail current="processing" />);

    expect(screen.getByText('Upload')).toBeInTheDocument();
    expect(screen.getByText('Configure')).toBeInTheDocument();
    expect(screen.getByText('Processing')).toHaveAttribute(
      'aria-current',
      'step'
    );
    expect(screen.getByText('Result')).toBeInTheDocument();
  });

  it('renders grouped catalog links with recommended flags', () => {
    renderWithIntl(
      <ToolCatalogGrid
        groups={[
          {
            key: 'image',
            titleKey: 'ToolCatalog.categories.imageOptimize',
            descriptionKey: 'ToolCatalog.categories.imageOptimizeDescription',
            tools: imageTools.slice(0, 1),
          },
        ]}
      />
    );

    expect(
      screen.getByRole('link', { name: /Image compression/ })
    ).toHaveAttribute('href', expect.stringContaining('/image/compress'));
    expect(screen.getByText('Recommended')).toBeInTheDocument();
  });

  it.each([
    { count: 0, twoColumnCount: 0, threeColumnCount: 0 },
    { count: 1, twoColumnCount: 1, threeColumnCount: 2 },
    { count: 2, twoColumnCount: 0, threeColumnCount: 1 },
    { count: 3, twoColumnCount: 1, threeColumnCount: 0 },
    { count: 10, twoColumnCount: 0, threeColumnCount: 2 },
  ])(
    'fills responsive grid rows for $count tools without adding links',
    ({ count, twoColumnCount, threeColumnCount }) => {
      const tools =
        count === 10 ? recommendedTools : imageTools.slice(0, count);
      const { container } = renderWithIntl(
        <ToolCatalogGrid
          groups={[
            {
              key: `tools-${count}`,
              titleKey: 'ToolCatalog.categories.imageOptimize',
              descriptionKey: 'ToolCatalog.categories.imageOptimizeDescription',
              tools,
            },
          ]}
        />
      );

      expect(screen.queryAllByRole('link')).toHaveLength(count);

      const twoColumnFillers = container.querySelectorAll(
        '[data-tool-grid-filler="two-column"]'
      );
      expect(twoColumnFillers).toHaveLength(twoColumnCount);
      for (const filler of twoColumnFillers) {
        expect(filler).toHaveAttribute('aria-hidden', 'true');
        expect(filler).toHaveClass(
          'hidden min-h-[132px] bg-card sm:block xl:hidden'
        );
      }

      const threeColumnFillers = container.querySelectorAll(
        '[data-tool-grid-filler="three-column"]'
      );
      expect(threeColumnFillers).toHaveLength(threeColumnCount);
      for (const filler of threeColumnFillers) {
        expect(filler).toHaveAttribute('aria-hidden', 'true');
        expect(filler).toHaveClass('hidden min-h-[132px] bg-card xl:block');
      }
    }
  );

  it('gives failure recovery explicit next actions', () => {
    const retry = vi.fn();
    const reset = vi.fn();

    renderWithIntl(
      <FailureRecoveryPanel
        message="The worker could not parse this file."
        errorCode="PDF_PARSE_FAILED"
        onRetry={retry}
        onReset={reset}
      />
    );

    expect(screen.getByText('PDF_PARSE_FAILED')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Replace file' })
    ).toBeInTheDocument();
  });

  it('renders a result panel with a download command and file metadata', () => {
    renderWithIntl(
      <ResultPanel
        title="compressed.png"
        description="Ready to download."
        meta={[
          { label: 'Original', value: '2 MB' },
          { label: 'Result', value: '900 KB' },
        ]}
        preview={<div role="img" aria-label="Result preview" />}
        action={<button type="button">Download</button>}
      />
    );

    expect(screen.getByText('compressed.png')).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Result preview' })
    ).toBeInTheDocument();
    expect(screen.getByText('Original')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Download' })
    ).toBeInTheDocument();
  });

  it('explains that server mode needs sign-in before server processing can run', () => {
    renderWithIntl(
      <ModeToggle value="server" onChange={vi.fn()} serverLoginRequired />
    );

    expect(
      screen.getByText(
        'Sign in to use server processing, task history, and account file storage.'
      )
    ).toBeInTheDocument();
  });

  it('lets tool content span the full shell width when no aside is present', () => {
    renderWithIntl(
      <ToolPageShell
        title="Document tool"
        description="Convert documents."
        processing="server"
        retention="account-files"
        requiresLogin
        recovery="Retry with another file."
        stage="configure"
      >
        <div>Full-width workbench</div>
      </ToolPageShell>
    );

    const grid = screen.getByText('Full-width workbench').parentElement
      ?.parentElement;

    expect(grid).toHaveClass('grid-cols-1');
    expect(grid).not.toHaveClass('lg:grid-cols-[minmax(0,1fr)_320px]');
  });

  it('keeps the secondary column only when tool aside content exists', () => {
    renderWithIntl(
      <ToolPageShell
        title="Document tool"
        description="Convert documents."
        processing="server"
        retention="account-files"
        requiresLogin
        recovery="Retry with another file."
        stage="configure"
        aside={<div>Side preview</div>}
      >
        <div>Narrow workbench</div>
      </ToolPageShell>
    );

    const grid =
      screen.getByText('Narrow workbench').parentElement?.parentElement;

    expect(grid).toHaveClass('lg:grid-cols-[minmax(0,1fr)_320px]');
    expect(screen.getByText('Side preview')).toBeInTheDocument();
  });
});
