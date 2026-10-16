import type { IngestOutcome, PostsRepository } from '../posts/posts.repository.js';
import type { IngestRequest } from './ingestion.schema.js';

export interface IngestSummary {
  received: number;
  accepted: number;
  duplicates: number;
  results: Array<IngestOutcome & { index: number }>;
}

export class IngestionService {
  constructor(
    private readonly posts: PostsRepository,
    /** Wakes the background worker; processing never runs inside the request. */
    private readonly onAccepted: () => void = () => {},
  ) {}

  async ingest(request: IngestRequest): Promise<IngestSummary> {
    const results: IngestSummary['results'] = [];
    // Sequential on purpose: each post is its own small transaction and batches are tiny.
    for (const [index, post] of request.posts.entries()) {
      results.push({ index, ...(await this.posts.ingest(post)) });
    }

    const accepted = results.filter((result) => result.status === 'accepted').length;
    if (accepted > 0) this.onAccepted();

    return {
      received: request.posts.length,
      accepted,
      duplicates: results.length - accepted,
      results,
    };
  }
}
