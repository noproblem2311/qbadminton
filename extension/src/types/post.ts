/** A post as captured from the Facebook DOM. Unknown fields are null, never guessed. */
export interface RawFacebookPost {
  postId: string | null;
  postUrl: string | null;
  groupId: string | null;
  author: string | null;
  content: string;
  /** ISO 8601; only set when the page exposes a parseable timestamp. */
  publishedAt: string | null;
  /** ISO 8601 time of extraction. */
  capturedAt: string;
}
