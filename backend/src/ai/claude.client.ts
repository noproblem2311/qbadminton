import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { ZodError, type z } from 'zod';

export interface StructuredRequest<T extends z.ZodType> {
  system: string;
  user: string;
  schema: T;
  maxTokens: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export interface StructuredResponse<T> {
  output: T;
  usage: TokenUsage;
}

/** The narrow surface the serializer depends on; tests substitute a fake. */
export interface StructuredLlmClient {
  generate<T extends z.ZodType>(request: StructuredRequest<T>): Promise<StructuredResponse<z.infer<T>>>;
}

/** Claude answered, but not with something usable. */
export class ClaudeOutputError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ClaudeOutputError';
  }
}

type MessagesApi = Pick<Anthropic['messages'], 'parse'>;

export class ClaudeClient implements StructuredLlmClient {
  constructor(
    private readonly messages: MessagesApi,
    private readonly model: string,
  ) {}

  static fromApiKey(apiKey: string, model: string): ClaudeClient {
    // SDK-level retries cover transient blips; the job queue handles longer outages.
    const anthropic = new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 });
    return new ClaudeClient(anthropic.messages, model);
  }

  async generate<T extends z.ZodType>(
    request: StructuredRequest<T>,
  ): Promise<StructuredResponse<z.infer<T>>> {
    const response = await this.messages.parse({
      model: this.model,
      max_tokens: request.maxTokens,
      // Stable system prompt first so repeated calls hit the prompt cache.
      system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: request.user }],
      output_config: { format: zodOutputFormat(request.schema), effort: 'low' },
    });

    if (response.stop_reason === 'refusal') {
      throw new ClaudeOutputError('Claude declined to process the post', false);
    }
    if (response.stop_reason === 'max_tokens') {
      throw new ClaudeOutputError('Claude output was truncated (max_tokens)', true);
    }
    if (response.parsed_output == null) {
      throw new ClaudeOutputError('Claude returned no parseable structured output', true);
    }

    return {
      output: response.parsed_output as z.infer<T>,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }
}

/** Whether a failed processing attempt is worth retrying later. */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof ClaudeOutputError) return error.retryable;
  if (error instanceof ZodError) return false;
  // 400/404/422 mean the request itself is wrong; retrying cannot fix it.
  if (
    error instanceof Anthropic.BadRequestError ||
    error instanceof Anthropic.NotFoundError ||
    error instanceof Anthropic.UnprocessableEntityError
  ) {
    return false;
  }
  // 401/403 (fixable config), 429, 5xx, connection errors and unknown failures.
  return true;
}

export function describeError(error: unknown): string {
  if (error instanceof Anthropic.APIError) {
    return `${error.name}${error.status ? ` (${error.status})` : ''}: ${error.message}`;
  }
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
