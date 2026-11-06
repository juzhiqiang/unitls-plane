import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import en from '../../../messages/en.json';
import { TaskRecoveryPanel } from '@/components/tasks/TaskRecoveryPanel';
import { taskReceipts } from '@/lib/tasks/task-receipts';
import { api } from '@/lib/api-client';
const session = vi.hoisted(() => ({
  data: { user: { id: 'recovery-user' } } as { user: { id: string } } | null,
  isPending: false,
}));
vi.mock('@/lib/auth-client', () => ({ useSession: () => session }));
vi.mock('@/lib/api-client', () => ({ api: { GET: vi.fn(), POST: vi.fn() } }));
vi.mock('@/i18n/navigation', () => ({
  Link: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props} />
  ),
}));
const key = '10101010-1010-4010-8010-101010101010';
const id = '20202020-2020-4020-8020-202020202020';
const receipt = {
  key,
  taskId: id,
  fingerprint: 'a'.repeat(64),
  type: 'pdf_merge',
  startedAt: Date.now(),
};
function content() {
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <NextIntlClientProvider
        locale="en"
        messages={{
          TaskRecovery: en.TaskRecovery,
          TasksTool: en.TasksTool,
          ToolsShared: en.ToolsShared,
        }}
      >
        <TaskRecoveryPanel />
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  session.data = { user: { id: 'recovery-user' } };
  taskReceipts.put('user:recovery-user', receipt);
});
afterEach(() => {
  taskReceipts.remove('user:recovery-user', key);
  vi.unstubAllGlobals();
});

describe('TaskRecoveryPanel', () => {
  it('preserves the server filename for markdown output', async () => {
    vi.mocked(api.GET).mockResolvedValue({
      data: [
        { taskId: id, status: 'completed', progress: 100, outputFileId: id },
      ],
    } as never);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('markdown', {
          headers: {
            'Content-Type': 'text/plain',
            'Content-Disposition':
              "inline; filename=report.md; filename*=UTF-8''%E6%8A%A5%E5%91%8A.md",
          },
        })
      )
    );
    URL.createObjectURL = vi.fn(() => 'blob:test');
    URL.revokeObjectURL = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    render(content());
    fireEvent.click(
      await screen.findByRole('button', { name: 'Download result' })
    );
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe(
      '报告.md'
    );
    click.mockRestore();
  });
  it('restores a queued task and explains background execution', async () => {
    vi.mocked(api.GET).mockResolvedValue({
      data: [{ taskId: id, status: 'pending', progress: 0 }],
    } as never);
    render(content());
    await screen.findByText('Queued');
    expect(
      screen.getByText(/Tasks continue on the server/)
    ).toBeInTheDocument();
    expect(api.POST).not.toHaveBeenCalled();
  });
  it('retries only the download after an output retrieval failure', async () => {
    vi.mocked(api.GET).mockResolvedValue({
      data: [
        { taskId: id, status: 'completed', progress: 100, outputFileId: id },
      ],
    } as never);
    const fetch = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', fetch);
    render(content());
    fireEvent.click(
      await screen.findByRole('button', { name: 'Download result' })
    );
    await screen.findByText(
      'Download failed. The completed task is still available; try downloading again.'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Download result' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(api.POST).not.toHaveBeenCalled();
  });
  it('keeps an unconfirmed receipt visible and never submits during recovery', async () => {
    taskReceipts.put('user:recovery-user', { ...receipt, taskId: undefined });
    vi.mocked(api.GET).mockResolvedValue({
      error: {},
      response: new Response(null, { status: 404 }),
    } as never);
    render(content());
    await screen.findByText(/Submission is not yet confirmed/);
    expect(api.POST).not.toHaveBeenCalled();
  });
  it('hides previous account tasks immediately when the account changes', async () => {
    vi.mocked(api.GET).mockResolvedValue({
      data: [{ taskId: id, status: 'pending', progress: 0 }],
    } as never);
    const { rerender } = render(content());
    await screen.findByText('Queued');
    await act(async () => {
      session.data = { user: { id: 'another-user' } };
      rerender(content());
    });
    expect(screen.queryByText('Queued')).not.toBeInTheDocument();
  });
});
