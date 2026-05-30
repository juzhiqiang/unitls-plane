import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import OfflinePage from '../page';

describe('OfflinePage', () => {
  it('explains offline status and local tool availability', () => {
    render(<OfflinePage />);

    expect(screen.getByText('You are offline')).toBeInTheDocument();
    expect(
      screen.getByText('Some local tools remain available offline.')
    ).toBeInTheDocument();
  });
});
