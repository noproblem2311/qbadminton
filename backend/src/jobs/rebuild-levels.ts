import { createDatabase } from '../database/client.js';
import { badmintonSessions, sessionLevels } from '../database/schema.js';
import { normalizeLevels } from '../lib/levels.js';

/**
 * CLI: recompute session_levels for every session from its level text.
 * Idempotent; run after deploying new level rules.
 */
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const handle = createDatabase(url);
try {
  const result = await handle.db.transaction(async (tx) => {
    const sessions = await tx.select({ id: badmintonSessions.id, level: badmintonSessions.level }).from(badmintonSessions);
    await tx.delete(sessionLevels);
    const links = sessions.flatMap((session) =>
      normalizeLevels(session.level).map((levelCode) => ({ sessionId: session.id, levelCode })),
    );
    if (links.length > 0) await tx.insert(sessionLevels).values(links);
    return { sessions: sessions.length, links: links.length };
  });
  console.log(`Rebuilt levels: ${result.links} level link(s) for ${result.sessions} session(s).`);
} finally {
  await handle.close();
}
