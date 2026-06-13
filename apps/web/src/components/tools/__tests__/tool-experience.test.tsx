import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '../../../../messages/en.json';
import { imageTools } from '@/lib/tools/tool-metadata';
import { FailureRecoveryPanel } from '../failure-recovery-panel';
import { ResultPanel } from '../result-panel';
import { ToolCatalogGrid } from '../tool-catalog-grid';
import { ToolStepRail } from '../tool-step-rail';
import { ToolTrustStrip } from '../tool-trust-strip';

function renderWithIntl(ui: React.ReactElement) {
  render(
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
        action={<button type="button">Download</button>}
      />
    );

    expect(screen.getByText('compressed.png')).toBeInTheDocument();
    expect(screen.getByText('Original')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Download' })
    ).toBeInTheDocument();
  });
});
