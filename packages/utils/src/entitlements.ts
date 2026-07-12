export type EntitlementPlan =
  | 'free'
  | 'signed_in'
  | 'pro_preview'
  | 'pro'
  | 'team'
  | 'private';

export type EntitlementUser = {
  userId?: string | null;
  plan?: string | null;
  role?: string | null;
};

export type FeatureKey =
  | 'upload.file'
  | 'task.serverProcessing'
  | 'image.animation.gif'
  | 'image.animation.apng'
  | 'image.animation.advancedCompression'
  | 'image.animation.batch'
  | 'image.stitch.basic'
  | 'image.stitch.batch'
  | 'image.stitch.brandFooter'
  | 'image.idPhoto.generate'
  | 'pdf.document.localExport'
  | 'pdf.document.serverExport';

export type LimitKey =
  | 'upload.maxFileSize'
  | 'image.animation.maxInputFiles'
  | 'image.animation.maxFileSize'
  | 'image.animation.maxFrames'
  | 'image.animation.maxCanvasPixels'
  | 'image.animation.maxTotalFramePixels'
  | 'image.animation.maxOutputWidth'
  | 'image.stitch.maxFiles'
  | 'image.stitch.maxFileSize'
  | 'image.stitch.maxCanvasPixels';

const PLAN_RANK: Record<EntitlementPlan, number> = {
  free: 0,
  signed_in: 1,
  pro_preview: 2,
  pro: 3,
  team: 4,
  private: 5,
};

const FEATURE_MIN_PLAN: Record<FeatureKey, EntitlementPlan> = {
  'upload.file': 'free',
  'task.serverProcessing': 'signed_in',
  'image.animation.gif': 'free',
  'image.animation.apng': 'signed_in',
  'image.animation.advancedCompression': 'signed_in',
  'image.animation.batch': 'signed_in',
  'image.stitch.basic': 'free',
  'image.stitch.batch': 'signed_in',
  'image.stitch.brandFooter': 'signed_in',
  'image.idPhoto.generate': 'signed_in',
  'pdf.document.localExport': 'free',
  'pdf.document.serverExport': 'signed_in',
};

const LIMITS: Record<LimitKey, Record<EntitlementPlan, number>> = {
  'upload.maxFileSize': {
    free: 10 * 1024 * 1024,
    signed_in: 50 * 1024 * 1024,
    pro_preview: 50 * 1024 * 1024,
    pro: 100 * 1024 * 1024,
    team: 150 * 1024 * 1024,
    private: 250 * 1024 * 1024,
  },
  'image.animation.maxInputFiles': {
    free: 24,
    signed_in: 120,
    pro_preview: 120,
    pro: 180,
    team: 240,
    private: 300,
  },
  'image.animation.maxFileSize': {
    free: 8 * 1024 * 1024,
    signed_in: 50 * 1024 * 1024,
    pro_preview: 50 * 1024 * 1024,
    pro: 80 * 1024 * 1024,
    team: 100 * 1024 * 1024,
    private: 150 * 1024 * 1024,
  },
  'image.animation.maxFrames': {
    free: 60,
    signed_in: 240,
    pro_preview: 240,
    pro: 360,
    team: 480,
    private: 600,
  },
  'image.animation.maxCanvasPixels': {
    free: 16_000_000,
    signed_in: 64_000_000,
    pro_preview: 64_000_000,
    pro: 96_000_000,
    team: 128_000_000,
    private: 160_000_000,
  },
  'image.animation.maxTotalFramePixels': {
    free: 48_000_000,
    signed_in: 160_000_000,
    pro_preview: 160_000_000,
    pro: 240_000_000,
    team: 320_000_000,
    private: 400_000_000,
  },
  'image.animation.maxOutputWidth': {
    free: 960,
    signed_in: 1920,
    pro_preview: 1920,
    pro: 2560,
    team: 3200,
    private: 4096,
  },
  'image.stitch.maxFiles': {
    free: 12,
    signed_in: 40,
    pro_preview: 40,
    pro: 80,
    team: 120,
    private: 200,
  },
  'image.stitch.maxFileSize': {
    free: 10 * 1024 * 1024,
    signed_in: 50 * 1024 * 1024,
    pro_preview: 50 * 1024 * 1024,
    pro: 80 * 1024 * 1024,
    team: 100 * 1024 * 1024,
    private: 150 * 1024 * 1024,
  },
  'image.stitch.maxCanvasPixels': {
    free: 32_000_000,
    signed_in: 96_000_000,
    pro_preview: 96_000_000,
    pro: 140_000_000,
    team: 180_000_000,
    private: 240_000_000,
  },
};

function isKnownPlan(plan: string | null | undefined): plan is EntitlementPlan {
  return Boolean(plan && plan in PLAN_RANK);
}

export function resolveEntitlementPlan(
  user?: EntitlementUser | null
): EntitlementPlan {
  if (!user?.userId) {
    return 'free';
  }

  if (user.role === 'admin') {
    return 'pro';
  }

  if (isKnownPlan(user.plan) && user.plan !== 'free') {
    return user.plan;
  }

  return 'signed_in';
}

export function isPlanAtLeast(
  actual: EntitlementPlan,
  required: EntitlementPlan
): boolean {
  return PLAN_RANK[actual] >= PLAN_RANK[required];
}

export function canUseFeature(
  user: EntitlementUser | null | undefined,
  feature: FeatureKey
): boolean {
  return isPlanAtLeast(resolveEntitlementPlan(user), FEATURE_MIN_PLAN[feature]);
}

export function getLimit(
  user: EntitlementUser | null | undefined,
  limit: LimitKey
): number {
  return LIMITS[limit][resolveEntitlementPlan(user)];
}
