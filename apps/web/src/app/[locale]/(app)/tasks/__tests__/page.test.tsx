import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, expect, it, vi } from 'vitest';
import en from '../../../../../../messages/en.json';
import TasksPage from '../page';

const mocks = vi.hoisted(() => ({ query: vi.fn(), owner: 'user-1' }));
vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: { user: { id: mocks.owner } } }),
}));
vi.mock('@/hooks/api/use-tasks', () => ({
  useTasks: (query: unknown, userId: string | undefined) =>
    mocks.query(query, userId),
  useRetryTask: () => ({ mutate: vi.fn(), isPending: false }),
}));
const page = () => (
  <NextIntlClientProvider locale="en" messages={en}>
    <TasksPage />
  </NextIntlClientProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.owner = 'user-1';
});

it('keeps the current cursor on refresh, resets filters and owner, disables next on errors', () => {
  mocks.query.mockReturnValue({
    data: { tasks: [], total: null, nextCursor: 'boundary' },
    isLoading: false,
  });
  const view = render(page());
  expect(mocks.query).toHaveBeenLastCalledWith(
    {
      cursor: '',
      includeTotal: false,
      limit: 20,
      status: undefined,
      category: undefined,
    },
    'user-1'
  );
  fireEvent.click(screen.getByRole('button', { name: 'Next', exact: true }));
  view.rerender(page());
  expect(mocks.query).toHaveBeenLastCalledWith(
    expect.objectContaining({ cursor: 'boundary' }),
    'user-1'
  );
  fireEvent.click(
    screen.getByRole('button', { name: en.TasksTool.failed, exact: true })
  );
  expect(mocks.query).toHaveBeenLastCalledWith(
    expect.objectContaining({ cursor: '', status: 'failed' }),
    'user-1'
  );
  fireEvent.click(screen.getByRole('button', { name: 'Next', exact: true }));
  mocks.owner = 'user-2';
  view.rerender(page());
  expect(mocks.query).toHaveBeenLastCalledWith(
    expect.objectContaining({ cursor: '' }),
    'user-2'
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

it('passes the type filter as category and does not filter returned rows locally', () => {
  const imageTask = {
    id: 'image-task',
    userId: 'user-1',
    type: 'compress',
    status: 'completed',
    inputFileIds: [],
    progress: 100,
    createdAt: '2026-09-11T00:00:00.000Z',
    completedAt: '2026-09-11T00:01:00.000Z',
  } as const;
  const pdfTask = {
    id: 'pdf-task',
    userId: 'user-1',
    type: 'pdf_merge',
    status: 'completed',
    inputFileIds: [],
    progress: 100,
    createdAt: '2026-09-11T00:00:00.000Z',
    completedAt: '2026-09-11T00:01:00.000Z',
  } as const;

  mocks.query.mockReturnValue({
    data: { tasks: [imageTask, pdfTask], total: null, nextCursor: null },
    isLoading: false,
  });
  render(page());

  fireEvent.click(
    screen.getByRole('button', { name: en.TasksTool.images, exact: true })
  );

  expect(mocks.query).toHaveBeenLastCalledWith(
    expect.objectContaining({ cursor: '', category: 'image' }),
    'user-1'
  );
  expect(screen.getAllByText(en.TasksTool.typePdfMerge)).not.toHaveLength(0);
});
