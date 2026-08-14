import { describe, expect, it } from 'bun:test';
import {
  canUseFeature,
  getLimit,
  isPlanAtLeast,
  resolveEntitlementPlan,
  type LimitKey,
} from './entitlements';

const limitKeys: LimitKey[] = [
  'upload.maxFileSize',
  'image.animation.maxInputFiles',
  'image.animation.maxFileSize',
  'image.animation.maxFrames',
  'image.animation.maxCanvasPixels',
  'image.animation.maxTotalFramePixels',
  'image.animation.maxOutputWidth',
  'image.stitch.maxFiles',
  'image.stitch.maxFileSize',
  'image.stitch.maxCanvasPixels',
];

describe('entitlements', () => {
  it('treats anonymous users as free and signed-in free users as signed_in', () => {
    expect(resolveEntitlementPlan()).toBe('free');
    expect(resolveEntitlementPlan({ userId: 'user-1', plan: 'free' })).toBe(
      'signed_in'
    );
  });

  it('preserves explicit commercial plans and admin override', () => {
    expect(resolveEntitlementPlan({ userId: 'user-1', plan: 'pro' })).toBe(
      'pro'
    );
    expect(resolveEntitlementPlan({ userId: 'user-1', role: 'admin' })).toBe(
      'pro'
    );
  });

  it('grants pro preview accounts the same top-tier limits as private accounts', () => {
    expect(isPlanAtLeast('pro_preview', 'private')).toBe(true);

    for (const limit of limitKeys) {
      expect(getLimit({ userId: 'preview', plan: 'pro_preview' }, limit)).toBe(
        getLimit({ userId: 'private', plan: 'private' }, limit)
      );
    }
  });

  it('gates commercial features behind signed-in or stronger plans', () => {
    expect(canUseFeature(undefined, 'image.animation.gif')).toBe(true);
    expect(canUseFeature(undefined, 'image.animation.apng')).toBe(false);
    expect(
      canUseFeature({ userId: 'user-1', plan: 'free' }, 'image.animation.apng')
    ).toBe(true);
    expect(canUseFeature(undefined, 'pdf.document.serverExport')).toBe(false);
    expect(
      canUseFeature(
        { userId: 'user-1', plan: 'free' },
        'pdf.document.serverExport'
      )
    ).toBe(true);
  });

  it('returns current upload and image limits for free and signed-in users', () => {
    expect(getLimit(undefined, 'upload.maxFileSize')).toBe(10 * 1024 * 1024);
    expect(getLimit({ userId: 'user-1' }, 'upload.maxFileSize')).toBe(
      50 * 1024 * 1024
    );
    expect(getLimit(undefined, 'image.animation.maxFrames')).toBe(60);
    expect(getLimit({ userId: 'user-1' }, 'image.animation.maxFrames')).toBe(
      240
    );
    expect(getLimit(undefined, 'image.stitch.maxFiles')).toBe(12);
    expect(getLimit({ userId: 'user-1' }, 'image.stitch.maxFiles')).toBe(40);
  });
});
