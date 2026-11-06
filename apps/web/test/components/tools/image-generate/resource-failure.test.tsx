import { renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { expect, it } from 'vitest';
import zh from '../../../../messages/zh.json';
import en from '../../../../messages/en.json';
import { useFailureText } from '@/components/tools/image-generate/generation-message';

it.each([
  ['zh', zh],
  ['en', en],
] as const)('生图资源错误使用 %s 命名空间中的实际文案', (locale, messages) => {
  const { result } = renderHook(() => useFailureText(), {
    wrapper: ({ children }) => (
      <NextIntlClientProvider locale={locale} messages={messages}>
        {children}
      </NextIntlClientProvider>
    ),
  });
  expect(result.current('TASK_RESOURCE_LIMIT_EXCEEDED', 'internal limit')).toBe(
    messages.TaskRecovery.resourceLimit
  );
});
