import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import en from '../../../../../messages/en.json';
import LoginPage from '@/app/[locale]/(auth)/login/page';

const mocks = vi.hoisted(() => ({ signInEmail: vi.fn() }));

vi.mock('@/lib/auth-client', () => ({
  signIn: { email: mocks.signInEmail },
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <LoginPage />
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

it('shows an error and restores the login button when the auth request throws', async () => {
  mocks.signInEmail.mockRejectedValue(new TypeError('Failed to fetch'));
  renderPage();

  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: 'owner@example.com' },
  });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'password123' },
  });
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    en.Auth.errors.generic
  );
  expect(screen.getByRole('button', { name: /sign in/i })).toBeEnabled();
});
