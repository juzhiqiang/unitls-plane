import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Changelog, type ChangelogEntry } from '../Changelog';

const entries: ChangelogEntry[] = [
  {
    version: 'v0.2.0',
    date: '2026-08-20',
    title: 'Public beta foundation',
    summary: 'The first public release of Utils Plane.',
    groups: [
      {
        title: 'New',
        items: ['Local image processing'],
      },
    ],
  },
];

describe('Changelog', () => {
  it('renders release metadata and grouped user-facing changes', () => {
    render(
      <Changelog
        eyebrow="Release notes"
        title="Changelog"
        intro="User-facing release notes."
        entries={entries}
      />
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Changelog' })
    ).toBeInTheDocument();
    expect(screen.getByText('User-facing release notes.')).toBeInTheDocument();
    expect(
      screen.getByRole('article', { name: 'Public beta foundation' })
    ).toBeInTheDocument();
    expect(screen.getByText('2026-08-20')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 3, name: 'New' })
    ).toBeInTheDocument();
    expect(screen.getByText('Local image processing')).toBeInTheDocument();
  });
});
