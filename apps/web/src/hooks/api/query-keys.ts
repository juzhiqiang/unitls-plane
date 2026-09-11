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

export const taskQueryKeys = {
  all: ['tasks'] as const,
  imageGenerateQuota: (userId?: string) =>
    userId ? [...imageGenerateQuotaKey, userId] : imageGenerateQuotaKey,
  imageGenerateProviders: () =>
    [...taskQueryKeys.all, 'image-generate', 'providers'] as const,
  imageGeneratePresets: (lang?: string) =>
    [...taskQueryKeys.all, 'image-generate', 'presets', lang] as const,
  imageGenerateSessions: (userId?: string) =>
    userId ? [...imageGenerateSessionsKey, userId] : imageGenerateSessionsKey,
  imageGenerateSessionTasks: (sessionId: string, userId?: string) =>
    userId
      ? [...imageGenerateSessionsKey, sessionId, 'tasks', userId]
      : [...imageGenerateSessionsKey, sessionId, 'tasks'],
};
