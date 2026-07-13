export const accountQueryKeys = {
  all: ['account'] as const,
  summaries: () => [...accountQueryKeys.all, 'summary'] as const,
  summary: (userId?: string) =>
    [...accountQueryKeys.summaries(), userId] as const,
};
