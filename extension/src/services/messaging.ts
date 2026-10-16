import { browser } from 'wxt/browser';
import type { MessageResult, RuntimeMessage } from '../types/messages';

/** Send a message to the background and unwrap its { ok, data | error } envelope. */
export async function sendMessage<T>(message: RuntimeMessage): Promise<T> {
  const result = (await browser.runtime.sendMessage(message)) as MessageResult<T> | undefined;
  if (!result) throw new Error('Không nhận được phản hồi từ extension');
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
