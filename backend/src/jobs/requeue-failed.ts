import { createDatabase } from '../database/client.js';
import { PostsRepository } from '../modules/posts/posts.repository.js';

/** CLI: move failed posts back to pending, e.g. after fixing ANTHROPIC_API_KEY. */
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const handle = createDatabase(url);
try {
  const count = await new PostsRepository(handle.db).requeueFailed();
  console.log(`Requeued ${count} failed post(s). The running backend will pick them up.`);
} finally {
  await handle.close();
}
