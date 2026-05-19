import { z } from 'zod';

export const uploadFileSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string(),
  size: z.number().positive(),
});

export const fileQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type UploadFileInput = z.infer<typeof uploadFileSchema>;
export type FileQuery = z.infer<typeof fileQuerySchema>;
