import type { Logger } from '../lib/logger.js';
import type { StructuredLlmClient } from './claude.client.js';
import { POST_SYSTEM_PROMPT, buildPostUserPrompt } from './post.prompt.js';
import {
  EMPTY_SESSION_DETAILS,
  aiOutputSchema,
  badmintonPostSchema,
  sanitizeAiSession,
  type BadmintonPost,
  type SessionDetails,
} from './post.schema.js';

export interface SerializerInput {
  author: string | null;
  content: string;
  publishedAt: Date | null;
  capturedAt: Date;
}

export type SerializerResult =
  | { relevant: false }
  | { relevant: true; posts: BadmintonPost[] };

export interface PostSerializer {
  serialize(input: SerializerInput): Promise<SerializerResult>;
}

const MAX_SESSIONS_PER_POST = 10;
const MAX_OUTPUT_TOKENS = 2048;

export class ClaudePostSerializer implements PostSerializer {
  constructor(
    private readonly llm: StructuredLlmClient,
    private readonly logger?: Logger,
  ) {}

  async serialize(input: SerializerInput): Promise<SerializerResult> {
    const { prompt, referenceDate } = buildPostUserPrompt(input);
    const { output, usage } = await this.llm.generate({
      system: POST_SYSTEM_PROMPT,
      user: prompt,
      schema: aiOutputSchema,
      maxTokens: MAX_OUTPUT_TOKENS,
    });
    this.logger?.debug({ usage, relevant: output.relevant }, 'claude serializer call');

    if (!output.relevant) return { relevant: false };

    const details = uniqueDetails(
      output.sessions
        .slice(0, MAX_SESSIONS_PER_POST)
        .map((session) => sanitizeAiSession(session, referenceDate)),
    );

    // Author and content always come from the captured post, never from the model.
    const posts = (details.length > 0 ? details : [EMPTY_SESSION_DETAILS]).map((detail) =>
      badmintonPostSchema.parse({ ...detail, author: input.author, content: input.content }),
    );
    return { relevant: true, posts };
  }
}

function uniqueDetails(details: SessionDetails[]): SessionDetails[] {
  const seen = new Set<string>();
  return details.filter((detail) => {
    const key = JSON.stringify(detail);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
