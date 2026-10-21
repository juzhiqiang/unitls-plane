import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IdPhotoQualityPanel } from '@/components/tools/id-photo-quality-panel';
import type { QualityReport } from '@utils-plane/validators';

const t = (key: string) => key;

type TVars = Record<string, string | number>;

// 假 t 模拟 next-intl 的变量插值:占位符只在传了对应变量时才替换,否则原样保留。
// 这样 `not.toContain('{items}')` 才有区分力——组件若没把 items 传给 t,
// 输出会保留占位符,断言就会失败。
const interpolate = (template: string, values?: TVars) =>
  template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    values && Object.prototype.hasOwnProperty.call(values, name)
      ? String(values[name])
      : placeholder
  );

const chineseT = (key: string, values?: TVars) =>
  interpolate(
    key === 'quality.needsAttention'
      ? '需注意:{items}'
      : key === 'quality.listSeparator'
        ? '、'
        : key,
    values
  );

const englishT = (key: string, values?: TVars) =>
  interpolate(
    key === 'quality.needsAttention'
      ? 'Needs attention: {items}'
      : key === 'quality.listSeparator'
        ? ', '
        : key === 'quality.score'
          ? 'Score {score}'
          : key,
    values
  );

function fullReport(): QualityReport {
  return {
    items: [
      {
        name: 'faceCount',
        value: '1',
        passed: true,
        hint: 'singleFrontalPortrait',
      },
      {
        name: 'faceCentered',
        value: '2%',
        passed: true,
        hint: 'adjustHorizontalPosition',
      },
      { name: 'faceRatio', value: '35%', passed: true, hint: 'faceRatioRange' },
      { name: 'eyeTilt', value: '+0.5°', passed: true, hint: 'levelEyes' },
      {
        name: 'headroom',
        value: '12%',
        passed: true,
        hint: 'headroomTooSmall',
      },
      {
        name: 'sharpness',
        value: '120',
        passed: true,
        hint: 'avoidBlurrySource',
      },
      {
        name: 'exposure',
        value: '128/255',
        passed: true,
        hint: 'avoidUnderexposedOrBlown',
      },
      {
        name: 'matteEdge',
        value: '3.1%',
        passed: true,
        hint: 'checkHairAndShoulder',
      },
    ],
    score: 100,
    passed: true,
  };
}

function failingReport(): QualityReport {
  return {
    items: [
      {
        name: 'faceCount',
        value: '2',
        passed: false,
        hint: 'singleFrontalPortrait',
      },
      {
        name: 'faceRatio',
        value: '15%',
        passed: false,
        hint: 'faceRatioRange',
      },
    ],
    score: 0,
    passed: false,
  };
}

describe('IdPhotoQualityPanel', () => {
  it('shows the passed summary when everything passes', () => {
    render(<IdPhotoQualityPanel report={fullReport()} t={t} />);
    expect(screen.getByText('quality.passed')).toBeTruthy();
  });

  it('is expanded by default', () => {
    render(<IdPhotoQualityPanel report={fullReport()} t={t} />);
    expect(screen.getByTestId('id-photo-quality-panel')).toHaveAttribute(
      'open'
    );
  });

  it('interpolates the failing item names into the needs-attention summary', () => {
    render(<IdPhotoQualityPanel report={failingReport()} t={chineseT} />);

    const summary = screen.getByText(/需注意:/);
    const text = summary.textContent ?? '';

    expect(text).toContain('quality.items.faceCount');
    expect(text).toContain('quality.items.faceRatio');
    expect(text).toContain(
      '需注意:quality.items.faceCount、quality.items.faceRatio'
    );
    // 占位符必须被替换掉，而不是原样渲染。
    expect(text).not.toContain('{items}');
  });

  it('joins failing item names with the English list separator', () => {
    render(<IdPhotoQualityPanel report={failingReport()} t={englishT} />);

    const summary = screen.getByText(/Needs attention:/);
    const text = summary.textContent ?? '';

    expect(text).toBe(
      'Needs attention: quality.items.faceCount, quality.items.faceRatio'
    );
    expect(text).not.toContain('、');
  });

  it('shows the score with the value interpolated by the translator', () => {
    render(<IdPhotoQualityPanel report={fullReport()} t={englishT} />);
    expect(screen.getByText('Score 100')).toBeTruthy();
  });

  it('falls back to the unavailable message when no item failed but the report did', () => {
    render(
      <IdPhotoQualityPanel
        report={{ items: [], score: 0, passed: false }}
        t={t}
      />
    );

    expect(screen.getByText('quality.unavailable')).toBeTruthy();
    expect(screen.queryByText(/quality\.needsAttention/)).toBeNull();
  });

  it('renders an unavailable state for a null report', () => {
    render(<IdPhotoQualityPanel report={null} t={t} />);
    expect(screen.getByText('quality.unavailable')).toBeTruthy();
  });

  it('lists every item with its name and measured value', () => {
    render(<IdPhotoQualityPanel report={fullReport()} t={t} />);

    const expected = [
      ['faceCount', '1'],
      ['faceCentered', '2%'],
      ['faceRatio', '35%'],
      ['eyeTilt', '+0.5°'],
      ['headroom', '12%'],
      ['sharpness', '120'],
      ['exposure', '128/255'],
      ['matteEdge', '3.1%'],
    ] as const;

    for (const [name, value] of expected) {
      expect(screen.getByText(`quality.items.${name}`)).toBeTruthy();
      expect(screen.getByText(value)).toBeTruthy();
    }
  });

  it('shows the hint only for failing items', () => {
    render(
      <IdPhotoQualityPanel
        report={{
          items: [
            {
              name: 'faceCount',
              value: '1',
              passed: true,
              hint: 'singleFrontalPortrait',
            },
            {
              name: 'faceRatio',
              value: '15%',
              passed: false,
              hint: 'faceRatioRange',
            },
          ],
          score: 50,
          passed: false,
        }}
        t={t}
      />
    );
    expect(screen.getByText('quality.hints.faceRatioRange')).toBeTruthy();
    // 通过项只显示名称与实测值，不显示「该怎么改」的提示。
    expect(
      screen.queryByText('quality.hints.singleFrontalPortrait')
    ).toBeNull();
  });
});
