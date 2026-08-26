export const accountQueryKeys = {
  all: ['account'] as const,
  summaries: () => [...accountQueryKeys.all, 'summary'] as const,
  summary: (userId?: string) =>
    [...accountQueryKeys.summaries(), userId] as const,
};

export const taskQueryKeys = {
  all: ['tasks'] as const,
  imageGenerateQuota: () =>
    [...taskQueryKeys.all, 'image-generate', 'quota'] as const,
  imageGenerateProviders: () =>
    [...taskQueryKeys.all, 'image-generate', 'providers'] as const,
  imageGeneratePresets: (lang?: string) =>
    [...taskQueryKeys.all, 'image-generate', 'presets', lang] as const,
};
