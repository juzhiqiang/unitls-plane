import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { expect, it, vi } from 'vitest';
import en from '../../../../../../messages/en.json';
import TasksPage from '../page';

const mocks = vi.hoisted(() => ({ query: vi.fn(), owner: 'user-1' }));
vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: { user: { id: mocks.owner } } }),
}));
vi.mock('@/hooks/api/use-tasks', () => ({
  useTasks: (query: unknown) => mocks.query(query),
  useRetryTask: () => ({ mutate: vi.fn(), isPending: false }),
}));
const page = () => (
  <NextIntlClientProvider locale="en" messages={en}>
    <TasksPage />
  </NextIntlClientProvider>
);

it('keeps the current cursor on refresh, resets filters and owner, disables next on errors', () => {
  mocks.query.mockReturnValue({
    data: { tasks: [], total: null, nextCursor: 'boundary' },
    isLoading: false,
  });
  const view = render(page());
  expect(mocks.query).toHaveBeenLastCalledWith({
    cursor: '',
    includeTotal: false,
    limit: 20,
    status: undefined,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Next', exact: true }));
  view.rerender(page());
  expect(mocks.query).toHaveBeenLastCalledWith(
    expect.objectContaining({ cursor: 'boundary' })
  );
  fireEvent.click(
    screen.getByRole('button', { name: en.TasksTool.failed, exact: true })
  );
  expect(mocks.query).toHaveBeenLastCalledWith(
    expect.objectContaining({ cursor: '', status: 'failed' })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Next', exact: true }));
  mocks.owner = 'user-2';
  view.rerender(page());
  expect(mocks.query).toHaveBeenLastCalledWith(
    expect.objectContaining({ cursor: '' })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Next', exact: true }));
  const refetch = vi.fn();
  mocks.query.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: true,
    refetch,
  });
  view.rerender(page());
  expect(
    screen.getByRole('button', { name: 'Next', exact: true })
  ).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Previous', exact: true })
  ).not.toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: en.Pagination.retry }));
  expect(refetch).toHaveBeenCalledTimes(1);
});
