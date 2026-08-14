import { describe, expect, it } from 'bun:test';
import { PLAN_DISPLAY_ORDER, getPlanDisplayLimits } from './plan-display';

describe('plan display limits', () => {
  it('returns every entitlement plan in a stable display order', () => {
    const plans = getPlanDisplayLimits();

    expect(plans.map(p => p.plan)).toEqual(PLAN_DISPLAY_ORDER);
    expect(PLAN_DISPLAY_ORDER).toEqual([
      'free',
      'signed_in',
      'pro_preview',
      'pro',
      'team',
      'private',
    ]);
  });

  it('exposes the upload file size limit for each plan', () => {
    const plans = getPlanDisplayLimits();
    const byPlan = Object.fromEntries(plans.map(p => [p.plan, p]));

    expect(byPlan.free.uploadMaxFileSize).toBe(10 * 1024 * 1024);
    expect(byPlan.signed_in.uploadMaxFileSize).toBe(50 * 1024 * 1024);
    expect(byPlan.pro_preview.uploadMaxFileSize).toBe(250 * 1024 * 1024);
    expect(byPlan.pro.uploadMaxFileSize).toBe(100 * 1024 * 1024);
    expect(byPlan.team.uploadMaxFileSize).toBe(150 * 1024 * 1024);
    expect(byPlan.private.uploadMaxFileSize).toBe(250 * 1024 * 1024);
  });

  it('marks the public beta top-tier plan for highlight', () => {
    const plans = getPlanDisplayLimits();
    const preview = plans.find(p => p.plan === 'pro_preview');

    expect(preview?.isPublicBetaTopTier).toBe(true);
    expect(plans.filter(p => p.isPublicBetaTopTier).length).toBe(1);
  });
});
