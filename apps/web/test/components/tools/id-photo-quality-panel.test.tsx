import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IdPhotoQualityPanel } from '@/components/tools/id-photo-quality-panel';
import type { QualityReport } from '@utils-plane/validators';

const t = (key: string) => key;

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

describe('IdPhotoQualityPanel', () => {
  it('shows the passed summary when everything passes', () => {
    render(<IdPhotoQualityPanel report={fullReport()} t={t} />);
    expect(screen.getByText('quality.passed')).toBeTruthy();
  });

  it('names the failing items when some checks fail', () => {
    render(
      <IdPhotoQualityPanel
        report={{
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
        }}
        t={t}
      />
    );
    expect(screen.getByText(/quality\.needsAttention/)).toBeTruthy();
  });

  it('renders an unavailable state for a null report', () => {
    render(<IdPhotoQualityPanel report={null} t={t} />);
    expect(screen.getByText('quality.unavailable')).toBeTruthy();
  });

  it('lists every item with its measured value', () => {
    render(<IdPhotoQualityPanel report={fullReport()} t={t} />);
    expect(screen.getByText('35%')).toBeTruthy();
    expect(screen.getByText('+0.5°')).toBeTruthy();
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
