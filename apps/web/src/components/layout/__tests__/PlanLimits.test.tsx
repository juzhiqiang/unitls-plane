import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PlanLimits } from '../PlanLimits';

const plans = [
  {
    plan: 'free' as const,
    uploadMaxFileSize: 10 * 1024 * 1024,
    isPublicBetaTopTier: false,
  },
  {
    plan: 'pro_preview' as const,
    uploadMaxFileSize: 250 * 1024 * 1024,
    isPublicBetaTopTier: true,
  },
];

const commonProps = {
  eyebrow: 'Plans & limits',
  title: 'Plans',
  intro: 'Compare upload limits across plans.',
  plans,
  labels: {
    plan: 'Plan',
    uploadLimit: 'Upload limit',
    notes: 'Notes',
  },
  planLabels: {
    free: 'Anonymous (Free)',
    signed_in: 'Signed in',
    pro_preview: 'Pro Preview',
    pro: 'Pro',
    team: 'Team',
    private: 'Private',
  },
  planNotes: {
    free: 'No login required',
    signed_in: '',
    pro_preview: 'Top beta allowance',
    pro: '',
    team: '',
    private: '',
  },
  betaNote: 'All plans are free during the public beta.',
};

describe('PlanLimits', () => {
  it('renders a comparison table with plan labels and formatted limits', () => {
    render(<PlanLimits {...commonProps} />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Plans' })
    ).toBeInTheDocument();
    expect(screen.getByText('10 MB')).toBeInTheDocument();
    expect(screen.getByText('250 MB')).toBeInTheDocument();
    expect(screen.getByText('Anonymous (Free)')).toBeInTheDocument();
    expect(screen.getByText('Pro Preview')).toBeInTheDocument();
    expect(
      screen.getByText('All plans are free during the public beta.')
    ).toBeInTheDocument();
  });

  it('highlights the public beta top-tier plan row', () => {
    render(
      <PlanLimits
        {...commonProps}
        eyebrow="套餐与额度"
        title="套餐"
        intro=""
        labels={{
          plan: '套餐',
          uploadLimit: '单文件上限',
          notes: '说明',
        }}
        planLabels={{
          free: '匿名',
          signed_in: '登录',
          pro_preview: '公测顶额',
          pro: '专业',
          team: '团队',
          private: '私有',
        }}
        planNotes={{
          free: '',
          signed_in: '',
          pro_preview: '顶额权益',
          pro: '',
          team: '',
          private: '',
        }}
        betaNote=""
      />
    );

    const previewRow = screen.getByText('公测顶额').closest('tr');
    expect(previewRow).toHaveAttribute('data-highlight', 'true');
  });
});
