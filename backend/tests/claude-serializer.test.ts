import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  ClaudeClient,
  ClaudeOutputError,
  isRetryableError,
  type StructuredLlmClient,
} from '../src/ai/claude.client.js';
import { POST_SYSTEM_PROMPT } from '../src/ai/post.prompt.js';
import type { AiOutput } from '../src/ai/post.schema.js';
import { ClaudePostSerializer } from '../src/ai/post.serializer.js';

const usage = {
  input_tokens: 420,
  output_tokens: 60,
  cache_read_input_tokens: 600,
  cache_creation_input_tokens: 0,
};

function fakeMessages(response: Record<string, unknown>) {
  const parse = vi.fn().mockResolvedValue({ usage, ...response });
  return { parse } as unknown as Pick<Anthropic['messages'], 'parse'> & { parse: typeof parse };
}

describe('ClaudeClient', () => {
  const schema = z.object({ ok: z.boolean() });
  const request = { system: 'system prompt', user: 'user prompt', schema, maxTokens: 512 };

  it('sends a cached system prompt, structured output format and low effort', async () => {
    const messages = fakeMessages({ stop_reason: 'end_turn', parsed_output: { ok: true } });
    const client = new ClaudeClient(messages, 'claude-haiku-5-5');

    const result = await client.generate(request);

    expect(result.output).toEqual({ ok: true });
    expect(result.usage).toEqual({
      inputTokens: 420,
      outputTokens: 60,
      cacheReadInputTokens: 600,
      cacheCreationInputTokens: 0,
    });
    const params = messages.parse.mock.calls[0]?.[0];
    expect(params).toMatchObject({
      model: 'claude-haiku-5-5',
      max_tokens: 512,
      system: [{ type: 'text', text: 'system prompt', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'user prompt' }],
      output_config: { effort: 'low', format: { type: 'json_schema' } },
    });
  });

  it.each([
    ['refusal', { stop_reason: 'refusal', parsed_output: null }, false],
    ['truncation', { stop_reason: 'max_tokens', parsed_output: null }, true],
    ['unparseable output', { stop_reason: 'end_turn', parsed_output: null }, true],
  ])('raises ClaudeOutputError on %s', async (_label, response, retryable) => {
    const client = new ClaudeClient(fakeMessages(response), 'claude-haiku-5-5');
    const error = await client.generate(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ClaudeOutputError);
    expect((error as ClaudeOutputError).retryable).toBe(retryable);
  });
});

describe('isRetryableError', () => {
  it('retries transient API failures but not malformed requests', () => {
    const headers = new Headers();
    expect(isRetryableError(new Anthropic.RateLimitError(429, undefined, 'slow down', headers))).toBe(true);
    expect(isRetryableError(new Anthropic.InternalServerError(500, undefined, 'oops', headers))).toBe(true);
    expect(isRetryableError(new Anthropic.APIConnectionError({ message: 'offline' }))).toBe(true);
    expect(isRetryableError(new Anthropic.BadRequestError(400, undefined, 'bad', headers))).toBe(false);
    expect(isRetryableError(new ClaudeOutputError('refused', false))).toBe(false);
  });
});

describe('ClaudePostSerializer', () => {
  const input = {
    author: 'Nguyễn Văn A',
    content: 'Tối nay sân Tuyên Sơn thiếu 2 nam trình TB+,\n19h-21h, ai giao lưu được thì ib mình.',
    publishedAt: new Date('2026-10-15T10:00:00+07:00'),
    capturedAt: new Date('2026-10-15T10:01:00+07:00'),
  };

  const llmReturning = (output: AiOutput) => {
    const generate = vi.fn().mockResolvedValue({
      output,
      usage: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    });
    return { llm: { generate } as unknown as StructuredLlmClient, generate };
  };

  it('produces the documented BadmintonPost for the example post', async () => {
    const { llm, generate } = llmReturning({
      relevant: true,
      sessions: [{ playDate: '2026-10-15', startTime: '19h', endTime: '21:00', level: 'TB+', location: 'Sân Tuyên Sơn' }],
    });

    const result = await new ClaudePostSerializer(llm).serialize(input);

    expect(result).toEqual({
      relevant: true,
      posts: [
        {
          author: 'Nguyễn Văn A',
          playDate: '2026-10-15',
          startTime: '19:00',
          endTime: '21:00',
          level: 'TB+',
          location: 'Sân Tuyên Sơn',
          content: input.content,
        },
      ],
    });
    const call = generate.mock.calls[0]?.[0];
    expect(call.system).toBe(POST_SYSTEM_PROMPT);
    expect(call.user).toContain('2026-10-15 Thứ Năm (T5) = hôm nay');
    expect(call.user).toContain(input.content);
  });

  it('returns irrelevant without sessions', async () => {
    const { llm } = llmReturning({ relevant: false, sessions: [] });
    expect(await new ClaudePostSerializer(llm).serialize(input)).toEqual({ relevant: false });
  });

  it('keeps a relevant post with unknown details as one all-null session', async () => {
    const { llm } = llmReturning({ relevant: true, sessions: [] });
    const result = await new ClaudePostSerializer(llm).serialize(input);
    expect(result).toMatchObject({
      relevant: true,
      posts: [{ playDate: null, startTime: null, endTime: null, level: null, location: null }],
    });
  });

  it('never trusts model-provided author/content and drops duplicate sessions', async () => {
    const session = { playDate: '2026-10-17', startTime: '18:00', endTime: '20:00', level: 'TB', location: 'Sân A' };
    const { llm } = llmReturning({
      relevant: true,
      sessions: [session, { ...session }, { ...session, playDate: '2026-10-18' }],
    });
    const result = await new ClaudePostSerializer(llm).serialize(input);
    if (!result.relevant) throw new Error('expected relevant');
    expect(result.posts.map((post) => post.playDate)).toEqual(['2026-10-17', '2026-10-18']);
    expect(result.posts.every((post) => post.author === input.author && post.content === input.content)).toBe(true);
  });
});
