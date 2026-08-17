import { render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '../../../../messages/en.json';
import { IdPhotoOptions, type IdPhotoOptionsState } from '../id-photo-options';

// 从 en.json 的 ImageIdPhoto 段构造 t:逐段查找,命中返回文案,
// 未命中(如 Task 8 才补的本地路文案 key)回退为 key 字符串本身,
// 测试即可断言该字符串出现。
const imageIdPhoto = (en as { ImageIdPhoto: Record<string, unknown> })
  .ImageIdPhoto;
const t = (key: string): string => {
  const parts = key.split('.');
  let cur: unknown = imageIdPhoto;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in cur) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return key;
    }
  }
  return typeof cur === 'string' ? cur : key;
};

const baseValue: IdPhotoOptionsState = {
  preset: 'one_inch',
  backgroundColor: '#438edb',
  outputType: 'image/jpeg',
  segmentationMode: 'local',
  crop: { x: 0.5, y: 0.5, scale: 1 },
};

// en.json 的真实结构与 next-intl 的 AbstractIntlMessages 索引签名不完全
// 兼容(存在嵌套数组),用 as never 绕过类型校验;运行时只读取 ImageIdPhoto 段。
function wrap(props: {
  mode?: 'local' | 'server';
  highPrecision?: boolean;
  highPrecisionDisabled?: boolean;
  onHighPrecisionChange?: (value: boolean) => void;
  disabled?: boolean;
}) {
  return render(
    <NextIntlClientProvider locale="en" messages={en as never}>
      <IdPhotoOptions value={baseValue} onChange={vi.fn()} t={t} {...props} />
    </NextIntlClientProvider>
  );
}

describe('IdPhotoOptions', () => {
  it('local mode hides segmentation mode, shows high precision toggle, and fires onChange', () => {
    const onChange = vi.fn();
    wrap({
      mode: 'local',
      highPrecision: false,
      onHighPrecisionChange: onChange,
      highPrecisionDisabled: false,
    });

    // 本地模式不应出现 segmentationMode 标签文案("Cutout mode")
    expect(screen.queryByText('Cutout mode')).not.toBeInTheDocument();
    // 也不应出现两个抠图模式选项
    expect(screen.queryByText('Standard')).not.toBeInTheDocument();
    expect(screen.queryByText('AI refine')).not.toBeInTheDocument();

    // 高精度开关应出现:label header + checkbox 旁 span 都渲染 localHighPrecision 文案。
    // Task 8 已补该 key,t 现在返回翻译文案,断言解析后的文本出现即可。
    expect(screen.getAllByText(t('localHighPrecision')).length).toBeGreaterThan(0);
    // checkbox 存在且未禁用(CPU 置灰需由 highPrecisionDisabled 控制)
    const toggle = document.querySelector(
      'input[type="checkbox"]'
    ) as HTMLInputElement;
    expect(toggle).not.toBeNull();
    expect(toggle.disabled).toBe(false);
    // 点击未禁用开关应触发 onHighPrecisionChange(true)
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('server mode shows segmentation mode and hides high precision', () => {
    wrap({ mode: 'server' });

    // 服务端模式:segmentationMode 标签 + 两个选项都出现
    expect(screen.getByText('Cutout mode')).toBeInTheDocument();
    expect(screen.getByText('Standard')).toBeInTheDocument();
    expect(screen.getByText('AI refine')).toBeInTheDocument();

    // 高精度开关不应出现
    expect(screen.queryByText('localHighPrecision')).not.toBeInTheDocument();
    // 服务端模式没有 checkbox
    expect(document.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it('high precision toggle disabled when highPrecisionDisabled', () => {
    const onChange = vi.fn();
    wrap({
      mode: 'local',
      highPrecision: false,
      onHighPrecisionChange: onChange,
      highPrecisionDisabled: true,
    });

    const toggle = document.querySelector(
      'input[type="checkbox"]'
    ) as HTMLInputElement;
    // CPU 置灰:checkbox 的 disabled 属性为 true(native disabled 是 React
    // 里置灰 checkbox 的惯用机制;真实浏览器会拦截点击,不会触发 onChange)。
    expect(toggle.disabled).toBe(true);

    // 置灰提示文案也应出现(Task 8 已补 localHighPrecisionLockedHint,断言解析后文案)
    expect(
      screen.getByText(t('localHighPrecisionLockedHint'))
    ).toBeInTheDocument();
  });
});
