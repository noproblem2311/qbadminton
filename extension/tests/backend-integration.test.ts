import { describe, expect, it } from 'vitest';
import { GroupMonitor } from '../src/monitor/group.monitor';
import { ApiClient } from '../src/services/api.client';
import type { ExtractedPost } from '../src/types/messages';
import { loadFacebookFixture } from './helpers';

/**
 * Optional end-to-end check against a running backend (use a development
 * instance, not production):
 *   QB_E2E_BACKEND_URL=http://localhost:3000 QB_E2E_API_KEY=... npm test
 * Every run uses a fresh group ID, so posts are accepted once and then deduplicated.
 */
const backendUrl = process.env.QB_E2E_BACKEND_URL;
const apiKey = process.env.QB_E2E_API_KEY ?? '';

describe.skipIf(!backendUrl)('extension → backend (live HTTP)', () => {
  it('extracts fixture posts, submits them, and the backend deduplicates a resubmission', async () => {
    loadFacebookFixture();
    const groupId = `e2e${Date.now()}`;
    const extracted: ExtractedPost[] = [];
    const monitor = new GroupMonitor({
      doc: document,
      getGroupId: () => groupId,
      submit: async (posts) => {
        extracted.push(...posts);
      },
      lazyRetryMs: 20,
    });
    await monitor.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    monitor.stop();
    expect(extracted.length).toBeGreaterThanOrEqual(4);

    // jsdom's AbortSignal is not accepted by Node's fetch; Chrome has no such mismatch.
    const nodeFetch: typeof fetch = (input, init) => fetch(input, { ...init, signal: undefined });
    const client = new ApiClient(
      async () => ({ backendUrl: backendUrl!, apiKey, refreshIntervalMinutes: 3 }),
      nodeFetch,
    );
    const posts = extracted.map((item) => item.post);

    const first = await client.ingest(posts);
    expect(first).toMatchObject({ received: posts.length, accepted: posts.length, duplicates: 0 });

    const again = await client.ingest(posts);
    expect(again).toMatchObject({ accepted: 0, duplicates: posts.length });
  });
});
