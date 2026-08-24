import type { EntitlementPlan } from './entitlements';
import { LIMITS } from './entitlements';

export const PLAN_DISPLAY_ORDER: EntitlementPlan[] = [
  'free',
  'signed_in',
  'pro_preview',
  'pro',
  'team',
  'private',
];

export interface PlanDisplayLimit {
  plan: EntitlementPlan;
  uploadMaxFileSize: number;
  imageGenerateDailyCount: number;
  isPublicBetaTopTier: boolean;
}

export function getPlanDisplayLimits(): PlanDisplayLimit[] {
  return PLAN_DISPLAY_ORDER.map(plan => ({
    plan,
    uploadMaxFileSize: LIMITS['upload.maxFileSize'][plan],
    imageGenerateDailyCount: LIMITS['image.generate.dailyCount'][plan],
    isPublicBetaTopTier: plan === 'pro_preview',
  }));
}
