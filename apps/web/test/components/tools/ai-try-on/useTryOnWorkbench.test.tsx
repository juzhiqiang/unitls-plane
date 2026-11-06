import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../../../messages/en.json';
import { useTryOnWorkbench } from '@/components/tools/ai-try-on/useTryOnWorkbench';
import { api } from '@/lib/api-client';
import { aiTryOnQueryKeys } from '@/hooks/api/use-ai-try-on';

vi.mock('@/lib/api-client', () => ({ api: { GET: vi.fn() } }));
vi.mock('@/hooks/use-require-login', () => ({
  useRequireLogin: () => ({ session: null, requireLogin: vi.fn() }),
}));
vi.mock('@/hooks/api/use-tasks', () => ({
  useImageGenerateQuota: () => ({ data: undefined }),
  useImageGenerateModels: () => ({ data: [] }),
}));
vi.mock('@/components/tools/ai-try-on/useTryOnTask', () => ({
  useTryOnTask: () => ({
    isBusy: false,
    handleSubmit: vi.fn(),
    setError: vi.fn(),
    setErrorCode: vi.fn(),
  }),
}));

const get = vi.mocked(api.GET);
const reference = (kind: string) => ({
  id: kind,
  kind,
  title: kind,
  tags: [],
  thumbnailUrl: '',
  sourceUrl: 'source',
  licenseName: 'CC0',
  attribution: 'Studio',
});

function setup(
  client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="en"
        messages={{ ImageTryOn: en.ImageTryOn }}
      >
        {children}
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
  return { ...renderHook(() => useTryOnWorkbench(), { wrapper }), client };
}

beforeEach(() => {
  get.mockReset();
  get.mockImplementation(
    async (_path, options) =>
      ({
        data: [
          reference(
            (options as { params: { query: { kind: string } } }).params.query
              .kind
          ),
        ],
      }) as never
  );
});

describe('try-on library demand and updates', () => {
  it('revalidates old cached quick picks when their selection creates demand on a return visit', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(
      aiTryOnQueryKeys.references('pose', 'en'),
      [reference('pose')],
      { updatedAt: Date.now() - 6 * 60_000 }
    );
    client.setQueryData(
      aiTryOnQueryKeys.references('garment', 'en'),
      [reference('garment')],
      { updatedAt: Date.now() - 6 * 60_000 }
    );
    get.mockResolvedValue({ data: [] } as never);
    const view = setup(client);
    expect(get).not.toHaveBeenCalled();
    act(() => {
      view.result.current.form.setPoseAssetId('pose');
      view.result.current.form.setStyleAssetId('garment');
    });
    await waitFor(() =>
      expect(view.result.current.form.poseAssetId).toBeNull()
    );
    expect(view.result.current.form.styleAssetId).toBeNull();
    expect(get).toHaveBeenCalledTimes(2);
    view.unmount();
    client.clear();
  });
  it('does not fetch catalogs for uploads, then shares garment data for inspiration and style', async () => {
    const { result, client, unmount } = setup();
    expect(get).not.toHaveBeenCalled();
    act(() => result.current.form.setPersonSource('library'));
    await waitFor(() =>
      expect(result.current.libraries.person.data).toHaveLength(1)
    );
    expect(get).toHaveBeenCalledTimes(1);
    act(() => result.current.form.setMode('inspiration'));
    await waitFor(() =>
      expect(result.current.libraries.garment.data).toHaveLength(1)
    );
    act(() => result.current.requestLibrary('garment'));
    expect(get).toHaveBeenCalledTimes(2);
    act(() => result.current.requestLibrary('pose'));
    await waitFor(() =>
      expect(result.current.libraries.pose.data).toHaveLength(1)
    );
    expect(get).toHaveBeenCalledTimes(3);
    unmount();
    client.clear();
  });

  it('preserves selections on refresh failure, then clears removed assets only after a successful update', async () => {
    const { result, client, unmount } = setup();
    act(() => {
      result.current.form.setPersonSource('library');
      result.current.form.setMode('inspiration');
      result.current.requestLibrary('pose');
    });
    await waitFor(() =>
      expect(result.current.libraries.pose.data).toHaveLength(1)
    );
    act(() => {
      result.current.form.setPersonAssetId('person');
      result.current.form.setGarmentAssetId('garment');
      result.current.form.setStyleAssetId('garment');
      result.current.form.setPoseAssetId('pose');
    });
    expect(result.current.canSubmit).toBe(true);
    get.mockResolvedValue({ error: new Error('offline') } as never);
    await act(async () => {
      await result.current.libraries.person.refetch();
    });
    await waitFor(() =>
      expect(result.current.libraries.person.isError).toBe(true)
    );
    expect(result.current.form.personAssetId).toBe('person');
    expect(result.current.canSubmit).toBe(true);
    get.mockResolvedValue({ data: [] } as never);
    await act(async () => {
      await Promise.all(
        Object.values(result.current.libraries).map(query => query.refetch())
      );
    });
    await waitFor(() => expect(result.current.form.personAssetId).toBeNull());
    expect(result.current.form.garmentAssetId).toBeNull();
    expect(result.current.form.poseAssetId).toBeNull();
    expect(result.current.form.styleAssetId).toBeNull();
    expect(result.current.canSubmit).toBe(false);
    expect(result.current.librarySelectionRemoved).toBe(true);
    unmount();
    client.clear();
  });
});
