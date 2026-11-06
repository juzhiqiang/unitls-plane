import React, { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '../../../../messages/en.json';
import zh from '../../../../messages/zh.json';
import {
  ReferenceLibraryGrid,
  type ReferenceLibraryGridProps,
} from '@/components/tools/ai-try-on/ReferenceLibraryGrid';
import type { AiTryOnReferenceAssetDto } from '@/hooks/api/types';

function asset(
  id: string,
  overrides: Partial<AiTryOnReferenceAssetDto> = {}
): AiTryOnReferenceAssetDto {
  return {
    id,
    kind: 'person',
    title: id,
    tags: [],
    thumbnailUrl: `https://cdn.example.test/${id}.webp`,
    sourceUrl: `https://source.example.test/${id}`,
    licenseName: 'CC0',
    attribution: 'Reference Studio',
    ...overrides,
  };
}

const poses = [
  asset('stand-side', {
    kind: 'pose',
    title: '自然站姿（侧面）',
    tags: ['female', 'side', 'balance'],
    thumbnailUrl: 'https://cdn.example.test/stand_side.webp',
  }),
  asset('stand-front', {
    kind: 'pose',
    title: '自然站姿（正面）',
    tags: ['female', 'front'],
    thumbnailUrl: 'https://cdn.example.test/stand_front.webp',
  }),
  asset('stand-front-duplicate', {
    kind: 'pose',
    title: '重复方向',
    tags: ['female'],
    thumbnailUrl: 'https://cdn.example.test/stand_front.webp',
  }),
  asset('walk', { kind: 'pose', title: '男性走姿', tags: ['male'] }),
];

function showLibrary(
  props: Partial<ReferenceLibraryGridProps> &
    Pick<ReferenceLibraryGridProps, 'items'>,
  locale: 'zh' | 'en' = 'zh'
) {
  const onSelect = props.onSelect ?? vi.fn();
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={{ ImageTryOn: (locale === 'zh' ? zh : en).ImageTryOn }}
    >
      <ReferenceLibraryGrid
        role="person"
        selectedId={null}
        onSelect={onSelect}
        {...props}
      />
    </NextIntlClientProvider>
  );
  fireEvent.click(
    screen.getByTestId(`open-library-modal-${props.role ?? 'person'}`)
  );
  return { onSelect, dialog: screen.getByRole('dialog') };
}

describe('ReferenceLibraryGrid', () => {
  it('moves back one visible page immediately after a refresh shrinks the catalog', () => {
    const items = Array.from({ length: 5 }, (_, i) => asset(`item-${i}`));
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <NextIntlClientProvider
        locale="en"
        messages={{ ImageTryOn: en.ImageTryOn }}
      >
        {children}
      </NextIntlClientProvider>
    );
    const props = {
      role: 'person' as const,
      selectedId: null,
      onSelect: vi.fn(),
      pageSize: 1,
    };
    const view = render(<ReferenceLibraryGrid {...props} items={items} />, {
      wrapper,
    });
    fireEvent.click(screen.getByTestId('open-library-modal-person'));
    for (let i = 0; i < 4; i++)
      fireEvent.click(screen.getByTestId('library-next-page-person'));
    view.rerender(
      <ReferenceLibraryGrid {...props} items={items.slice(0, 2)} />
    );
    expect(
      screen.getByTestId('library-page-indicator-person')
    ).toHaveTextContent('Page 2 / 2');
    fireEvent.click(screen.getByTestId('library-prev-page-person'));
    expect(
      screen.getByTestId('library-page-indicator-person')
    ).toHaveTextContent('Page 1 / 2');
    expect(
      screen.getByTestId('library-item-person-item-0')
    ).toBeInTheDocument();
  });
  it('offers an unloaded library without claiming it is empty and opens it after loading', () => {
    const onLoad = vi.fn();
    const props = {
      role: 'pose' as const,
      selectedId: null,
      onSelect: vi.fn(),
      onLoad,
    };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <NextIntlClientProvider
        locale="en"
        messages={{ ImageTryOn: en.ImageTryOn }}
      >
        {children}
      </NextIntlClientProvider>
    );
    const view = render(
      <ReferenceLibraryGrid {...props} items={[]} isRequested={false} />,
      { wrapper }
    );
    expect(screen.queryByTestId('library-empty-pose')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('open-library-modal-pose'));
    expect(onLoad).toHaveBeenCalledOnce();
    view.rerender(
      <ReferenceLibraryGrid {...props} items={poses} isRequested />
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('retains selection, filters and page when background refresh fails and offers retry in the dialog', () => {
    const onRetry = vi.fn();
    const { dialog } = showLibrary(
      {
        items: [asset('first'), asset('second')],
        selectedId: 'first',
        isError: true,
        onRetry,
        pageSize: 1,
      },
      'en'
    );
    expect(screen.getByTestId('selected-summary-person')).toBeInTheDocument();
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Could not refresh'
    );
    fireEvent.click(screen.getByTestId('library-next-page-person'));
    fireEvent.click(
      within(dialog).getByRole('button', { name: /Retry loading/ })
    );
    expect(onRetry).toHaveBeenCalledOnce();
    expect(
      screen.getByTestId('library-item-person-second')
    ).toBeInTheDocument();
  });

  it('allows refreshing an empty library and prevents another refresh while fetching', () => {
    const onRetry = vi.fn();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <NextIntlClientProvider
        locale="en"
        messages={{ ImageTryOn: en.ImageTryOn }}
      >
        {children}
      </NextIntlClientProvider>
    );
    const props = {
      role: 'pose' as const,
      items: [],
      selectedId: null,
      onSelect: vi.fn(),
      onRetry,
    };
    const view = render(<ReferenceLibraryGrid {...props} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh library' }));
    expect(onRetry).toHaveBeenCalledOnce();
    view.rerender(<ReferenceLibraryGrid {...props} isRefreshing />);
    expect(
      screen.getByRole('button', { name: 'Refreshing library…' })
    ).toBeDisabled();
  });
  it('groups pose angles, keeps the first duplicate, and selects a direction without closing', () => {
    const { dialog, onSelect } = showLibrary({ role: 'pose', items: poses });

    expect(
      within(dialog).getByTestId('pose-gender-filter-all')
    ).toHaveTextContent('全部 (2)');
    expect(
      within(dialog).getByTestId('pose-gender-filter-female')
    ).toHaveTextContent('女性 (1)');
    expect(
      within(dialog).getByTestId('pose-gender-filter-male')
    ).toHaveTextContent('男性 (1)');
    const card = screen.getByTestId('library-card-pose-stand-front');
    expect(within(card).getByText('自然站姿')).toBeInTheDocument();
    const directions = within(card).getByRole('group', {
      name: '切换姿势方向',
    });
    expect(
      within(directions)
        .getAllByRole('button')
        .map(button => button.textContent)
    ).toEqual(['正面', '侧面']);
    fireEvent.click(within(directions).getByRole('button', { name: /侧面/ }));
    expect(onSelect).toHaveBeenLastCalledWith('stand-side');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(
      screen.getByTestId('library-item-pose-stand-side')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('library-item-pose-stand-side'));
    expect(onSelect).toHaveBeenLastCalledWith('stand-side');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('finds a pose using a tag on any direction while keeping the full group', () => {
    const { dialog } = showLibrary({ role: 'pose', items: poses });
    fireEvent.change(within(dialog).getByRole('searchbox'), {
      target: { value: '  BALANCE  ' },
    });
    expect(
      screen.getByTestId('library-card-pose-stand-front')
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('library-card-pose-walk')
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: /侧面/ })
    ).toBeInTheDocument();
    expect(screen.getByTestId('library-page-indicator-pose')).toHaveTextContent(
      '共 1 项'
    );
  });

  it('counts garment styles within the gender filter and resets style when gender changes', () => {
    const items = [
      asset('spring-female', {
        kind: 'garment',
        title: '女装春日风衣',
        tags: ['female', 'spring', 'dress'],
      }),
      asset('party-female', {
        kind: 'garment',
        title: '女装礼服',
        tags: ['female', 'party'],
      }),
      asset('summer-male', {
        kind: 'garment',
        title: '男装短裤',
        tags: ['male', 'shorts'],
      }),
      asset('default-female', { kind: 'garment', title: '素色上衣' }),
    ];
    const { dialog } = showLibrary({ role: 'garment', items, pageSize: 2 });
    expect(screen.getByTestId('gender-filter-female')).toHaveTextContent(
      '女性 (3)'
    );
    expect(screen.getByTestId('style-filter-spring')).toHaveTextContent(
      '春日穿搭 (1)'
    );
    expect(screen.getByTestId('style-filter-party')).toHaveTextContent(
      '派对礼服 (1)'
    );
    fireEvent.click(screen.getByTestId('style-filter-party'));
    expect(
      screen.getByTestId('library-item-garment-party-female')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('gender-filter-male'));
    expect(screen.getByTestId('style-filter-all')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByTestId('style-filter-all')).toHaveTextContent(
      '全部风格 (1)'
    );
    expect(screen.queryByTestId('style-filter-party')).not.toBeInTheDocument();
    expect(
      screen.getByTestId('library-item-garment-summer-male')
    ).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole('searchbox'), {
      target: { value: '不存在' },
    });
    expect(
      within(dialog).getByText(
        '没有找到匹配的参考图，请尝试其他关键词或筛选条件。'
      )
    ).toBeInTheDocument();
    expect(screen.getByTestId('style-filter-summer')).toHaveTextContent(
      '夏日穿搭 (1)'
    );
  });

  it('resets pagination for search and gender, supports keyboard paging, and preserves license links', () => {
    const items = [
      asset('woman-one', { title: 'Woman One', tags: ['female'] }),
      asset('man-two', { title: 'Man Two', tags: ['male'] }),
      asset('neutral-three', {
        title: 'Neutral Three',
        description: 'Editorial portrait',
      }),
    ];
    const { dialog } = showLibrary({ items, pageSize: 1 }, 'en');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(
      screen.getByTestId('library-item-person-man-two')
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('library-page-indicator-person')
    ).toHaveTextContent('Page 2 / 3 (3)');
    fireEvent.change(within(dialog).getByRole('searchbox'), {
      target: { value: 'EDITORIAL' },
    });
    expect(
      screen.getByTestId('library-page-indicator-person')
    ).toHaveTextContent('Page 1 / 1 (1)');
    const card = screen.getByTestId('library-card-person-neutral-three');
    expect(within(card).getByText(/CC0/)).toBeInTheDocument();
    expect(within(card).getByText(/Reference Studio/)).toBeInTheDocument();
    const source = within(card).getByRole('link');
    expect(source).toHaveAttribute(
      'href',
      'https://source.example.test/neutral-three'
    );
    expect(source).toHaveAttribute('target', '_blank');
    fireEvent.change(within(dialog).getByRole('searchbox'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByTestId('library-next-page-person'));
    fireEvent.click(screen.getByTestId('gender-filter-female'));
    expect(
      screen.getByTestId('library-page-indicator-person')
    ).toHaveTextContent('Page 1 / 1 (1)');
    expect(
      screen.getByTestId('library-item-person-woman-one')
    ).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('uses the first sorted angle for quick picks and keeps optional clearing inside the modal', () => {
    const onSelect = vi.fn();
    function ControlledLibrary() {
      const [selectedId, setSelectedId] = useState<string | null>(null);
      return (
        <ReferenceLibraryGrid
          role="pose"
          items={poses}
          optional
          showQuickPicks
          selectedId={selectedId}
          onSelect={id => {
            setSelectedId(id);
            onSelect(id);
          }}
        />
      );
    }
    render(
      <NextIntlClientProvider
        locale="zh"
        messages={{ ImageTryOn: zh.ImageTryOn }}
      >
        <ControlledLibrary />
      </NextIntlClientProvider>
    );
    fireEvent.click(
      screen.getByRole('button', { name: '自然站姿（正面） 自然站姿（正面）' })
    );
    expect(onSelect).toHaveBeenLastCalledWith('stand-front');
    const summary = screen.getByTestId('selected-summary-pose');
    fireEvent.click(within(summary).getByRole('button', { name: /侧面/ }));
    expect(onSelect).toHaveBeenLastCalledWith('stand-side');
    fireEvent.click(screen.getByTestId('open-library-modal-pose'));
    expect(screen.getByTestId('library-item-pose-stand-side')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    fireEvent.click(screen.getByTestId('library-item-pose-stand-side'));
    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('keeps rapid keyboard pagination updates', () => {
    const items = [asset('first'), asset('second'), asset('third')];
    showLibrary({ items, pageSize: 1 }, 'en');

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });

    expect(
      screen.getByTestId('library-page-indicator-person')
    ).toHaveTextContent('Page 3 / 3 (3)');
    expect(screen.getByTestId('library-item-person-third')).toBeInTheDocument();
  });

  it('clamps the displayed page after items shrink and returns to the selected asset preview', () => {
    const items = [asset('first'), asset('second'), asset('third')];
    const onSelect = vi.fn();
    const { rerender } = render(
      <NextIntlClientProvider
        locale="en"
        messages={{ ImageTryOn: en.ImageTryOn }}
      >
        <ReferenceLibraryGrid
          role="person"
          items={items}
          selectedId={null}
          onSelect={onSelect}
          pageSize={1}
        />
      </NextIntlClientProvider>
    );
    fireEvent.click(screen.getByTestId('open-library-modal-person'));
    fireEvent.click(screen.getByTestId('library-next-page-person'));
    fireEvent.click(screen.getByTestId('library-next-page-person'));
    rerender(
      <NextIntlClientProvider
        locale="en"
        messages={{ ImageTryOn: en.ImageTryOn }}
      >
        <ReferenceLibraryGrid
          role="person"
          items={[items[0]!]}
          selectedId="first"
          onSelect={onSelect}
          pageSize={1}
        />
      </NextIntlClientProvider>
    );
    expect(
      screen.getByTestId('library-page-indicator-person')
    ).toHaveTextContent('Page 1 / 1 (1)');
    expect(screen.getByTestId('library-item-person-first')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('close-library-modal-person'));
    const summary = screen.getByTestId('selected-summary-person');
    fireEvent.keyDown(within(summary).getByRole('button', { name: 'first' }), {
      key: 'Enter',
    });
    expect(screen.getAllByRole('img', { name: 'first' })).toHaveLength(2);
  });

  it('keeps quick picks and the library trigger disabled while processing', () => {
    const onSelect = vi.fn();
    render(
      <NextIntlClientProvider
        locale="en"
        messages={{ ImageTryOn: en.ImageTryOn }}
      >
        <ReferenceLibraryGrid
          role="person"
          items={[asset('first')]}
          selectedId={null}
          onSelect={onSelect}
          disabled
          showQuickPicks
        />
      </NextIntlClientProvider>
    );
    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('exposes retry and upload recovery for errors', () => {
    const onRetry = vi.fn();
    const onFallbackToUpload = vi.fn();
    render(
      <NextIntlClientProvider
        locale="en"
        messages={{ ImageTryOn: en.ImageTryOn }}
      >
        <ReferenceLibraryGrid
          role="person"
          items={[]}
          selectedId={null}
          onSelect={vi.fn()}
          isError
          onRetry={onRetry}
          onFallbackToUpload={onFallbackToUpload}
        />
      </NextIntlClientProvider>
    );
    const alert = screen.getByRole('alert');
    const actions = within(alert).getAllByRole('button');
    fireEvent.click(actions[0]!);
    fireEvent.click(actions[1]!);
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onFallbackToUpload).toHaveBeenCalledOnce();
  });
});
