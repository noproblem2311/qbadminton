/**
 * Rules that settle a post before it reaches the AI, saving the call.
 * "pass" (pass sân / pass vợt / tìm sân pass) is never a vãng lai recruitment post.
 * Whole word, any case: "Pass sân" and "PASS" match; "password", "bypass" do not.
 */
const PASS_WORD = /(?<!\p{L})pass(?!\p{L})/iu;

export const PASS_SKIP_REASON = 'Có chữ "pass" — pass sân/đồ, không phải bài tuyển vãng lai';

/** Why a post can be marked irrelevant without AI, or null when it needs the AI. */
export function preAiSkipReason(content: string): string | null {
  return PASS_WORD.test(content) ? PASS_SKIP_REASON : null;
}
