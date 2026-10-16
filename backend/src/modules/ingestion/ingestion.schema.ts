import { z } from 'zod';
import { tidyContent } from '../../lib/text.js';

const isFacebookHost = (hostname: string) =>
  hostname === 'facebook.com' || hostname.endsWith('.facebook.com');

const facebookUrlSchema = z
  .url({ protocol: /^https$/u, hostname: /^(?:[a-z0-9-]+\.)*facebook\.com$/iu })
  .max(2048)
  .refine((value) => isFacebookHost(new URL(value).hostname), 'Must be a facebook.com URL');

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

export const rawFacebookPostSchema = z.object({
  postId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.:-]{1,128}$/u, 'Invalid Facebook post ID')
    .nullish()
    .transform((value) => value ?? null),
  postUrl: facebookUrlSchema.nullish().transform((value) => value ?? null),
  groupId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.-]{1,128}$/u, 'Invalid Facebook group ID')
    .nullish()
    .transform((value) => value ?? null),
  author: optionalText(200),
  content: z
    .string()
    .max(20_000)
    .transform(tidyContent)
    .pipe(z.string().min(1, 'Content must not be empty')),
  publishedAt: z.iso
    .datetime({ offset: true })
    .nullish()
    .transform((value) => (value ? new Date(value) : null)),
  capturedAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
});

export const ingestRequestSchema = z.object({
  posts: z.array(rawFacebookPostSchema).min(1).max(50),
});

export type IngestRequest = z.infer<typeof ingestRequestSchema>;
