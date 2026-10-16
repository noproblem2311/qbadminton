import { z } from 'zod';
import { processingStatusEnum } from '../../database/schema.js';

export const RAW_POSTS_PAGE_SIZE = 30;

export const listPostsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(RAW_POSTS_PAGE_SIZE),
  status: z.enum(processingStatusEnum.enumValues).optional(),
});

export type ListPostsQuery = z.infer<typeof listPostsQuerySchema>;
