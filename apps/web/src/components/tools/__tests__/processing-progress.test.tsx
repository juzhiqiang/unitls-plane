import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import en from '../../../../messages/en.json';
import { ProcessingProgress } from '../processing-progress';

describe('ProcessingProgress', () => {
  it('shows a stage label and bounded percent', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ProcessingProgress progress={143} stage="generating" />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText('Generating result')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });
});
