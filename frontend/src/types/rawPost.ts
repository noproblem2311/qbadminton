export type ProcessingStatus = 'pending' | 'processing' | 'parsed' | 'duplicate' | 'irrelevant' | 'failed';

export const PROCESSING_STATUSES: ProcessingStatus[] = ['pending', 'processing', 'parsed', 'duplicate', 'irrelevant', 'failed'];

export interface RawPost {
  id: string;
  facebookPostId: string | null;
  groupId: string | null;
  postUrl: string | null;
  author: string | null;
  content: string;
  publishedAt: string | null;
  capturedAt: string;
  processingStatus: ProcessingStatus;
  processingAttempts: number;
  lastError: string | null;
  /** For duplicates: the earlier post whose session this one repeats. */
  duplicateOfPostId: string | null;
  /** Set when a rule marked the post irrelevant without calling the AI. */
  skipReason: string | null;
  sessionCount: number;
  createdAt: string;
}

export interface RawPostsResult {
  posts: RawPost[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  counts: Record<ProcessingStatus, number>;
}
