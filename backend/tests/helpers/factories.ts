import type { Database } from '../../src/database/client.js';
import { badmintonSessions, sessionLevels } from '../../src/database/schema.js';
import { PostsRepository, type IncomingRawPost } from '../../src/modules/posts/posts.repository.js';
import { toSessionInsert } from '../../src/modules/sessions/sessions.mapper.js';
import type { BadmintonPost } from '../../src/ai/post.schema.js';

let counter = 0;

export function rawPostPayload(overrides: Record<string, unknown> = {}) {
  counter += 1;
  return {
    postId: `10000000000${counter}`,
    postUrl: `https://www.facebook.com/groups/caulongdanang/posts/10000000000${counter}/`,
    groupId: 'caulongdanang',
    author: 'Nguyễn Văn A',
    content: `Tối nay sân Tuyên Sơn thiếu 2 nam trình TB+, 19h-21h (#${counter})`,
    publishedAt: '2026-10-15T10:00:00+07:00',
    capturedAt: '2026-10-15T10:05:00+07:00',
    ...overrides,
  };
}

export function incomingPost(overrides: Partial<IncomingRawPost> = {}): IncomingRawPost {
  counter += 1;
  return {
    postId: `20000000000${counter}`,
    postUrl: null,
    groupId: 'caulongdanang',
    author: 'Trần Thị B',
    content: `Thiếu 1 nữ TB sân Chi Lăng tối mai 18h-20h (#${counter})`,
    publishedAt: new Date('2026-10-15T10:00:00+07:00'),
    capturedAt: new Date('2026-10-15T10:05:00+07:00'),
    ...overrides,
  };
}

/** Insert a raw post plus one parsed session directly (bypassing the worker). */
export async function insertSession(
  db: Database,
  details: Partial<Omit<BadmintonPost, 'author' | 'content'>> & { content?: string },
) {
  const posts = new PostsRepository(db);
  const post = incomingPost(details.content ? { content: details.content } : {});
  const { id } = await posts.ingest(post);
  const raw = await posts.findById(id);
  if (!raw) throw new Error('raw post missing');
  const { row, levels } = toSessionInsert(raw, {
    author: raw.author,
    content: raw.content,
    playDate: details.playDate ?? null,
    startTime: details.startTime ?? null,
    endTime: details.endTime ?? null,
    level: details.level ?? null,
    location: details.location ?? null,
  });
  const [inserted] = await db.insert(badmintonSessions).values(row).returning();
  if (!inserted) throw new Error('session insert failed');
  if (levels.length > 0) {
    await db.insert(sessionLevels).values(levels.map((levelCode) => ({ sessionId: inserted.id, levelCode })));
  }
  return inserted;
}
