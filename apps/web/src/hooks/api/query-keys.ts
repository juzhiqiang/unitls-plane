export const accountQueryKeys = {
  all: ['account'] as const,
  summaries: () => [...accountQueryKeys.all, 'summary'] as const,
  summary: (userId?: string) =>
    [...accountQueryKeys.summaries(), userId] as const,
};

const imageGenerateQuotaKey = ['tasks', 'image-generate', 'quota'] as const;
const imageGenerateSessionsKey = [
  'tasks',
  'image-generate',
  'sessions',
] as const;
const catalogQueryKey = ['catalog'] as const;

export const taskQueryKeys = {
  all: ['tasks'] as const,
  imageGenerateQuota: (userId?: string) =>
    userId ? [...imageGenerateQuotaKey, userId] : imageGenerateQuotaKey,
  imageGenerateModels: () =>
    [...catalogQueryKey, 'image-generate', 'models'] as const,
  imageGeneratePresets: (lang?: string) =>
    [...catalogQueryKey, 'image-generate', 'presets', lang] as const,
  imageGenerateSessions: (userId?: string) =>
    userId ? [...imageGenerateSessionsKey, userId] : imageGenerateSessionsKey,
  imageGenerateSessionTasks: (sessionId: string, userId?: string) =>
    userId
      ? [...imageGenerateSessionsKey, sessionId, 'tasks', userId]
      : [...imageGenerateSessionsKey, sessionId, 'tasks'],
};
