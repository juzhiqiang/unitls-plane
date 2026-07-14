import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LegalDocument } from '../LegalDocument';

describe('LegalDocument', () => {
  it('renders a semantic document with sections, a list, and support email', () => {
    render(
      <LegalDocument
        title="Privacy Policy"
        effectiveDate="Effective date: July 14, 2026"
        intro="How data is handled."
        sections={[
          {
            id: 'local-processing',
            title: 'Local processing',
            paragraphs: ['Files remain in the browser.'],
            items: ['Download the result before leaving.'],
          },
        ]}
        operatorLabel="Operator"
        operator="Utils Plane 项目团队"
        supportLabel="Support email"
        supportEmail="support@example.com"
      />
    );

    expect(
      screen.getByRole('article', { name: 'Privacy Policy' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Local processing' })
    ).toBeInTheDocument();
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(
      screen.getByText('Files remain in the browser.')
    ).toBeInTheDocument();
    expect(screen.getByText('Utils Plane 项目团队')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'support@example.com' })
    ).toHaveAttribute('href', 'mailto:support@example.com');
  });
});
