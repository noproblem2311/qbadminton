# Architecture

## Data flow

1. **Extension content script** (`extension/src/entrypoints/facebook.content.ts`) runs on facebook.com but stays idle unless the background says the tab is monitored. When active, `GroupMonitor` scans the feed immediately, again after every debounced DOM mutation, and again after Facebook expands truncated text.
2. Extracted posts go to the **background service worker**, which drops already-acknowledged keys, persists them in an outbox (`chrome.storage.local`) and POSTs batches of up to 25 to the backend. Failures retry with exponential backoff (5 s → 5 min, 8 attempts per post).
3. **Backend ingestion** validates with Zod, authenticates the shared key (constant-time compare), and stores each post in its own transaction. Each new post wakes the worker; Claude is never called inside the request.
4. **Worker** (in-process, `backend/src/jobs/`) claims due rows with `FOR UPDATE SKIP LOCKED`, calls the serializer, and records `parsed`/`irrelevant`, or a retry with backoff, or `failed`. Rows stuck in `processing` (crash, restart) are returned to the queue after 10 minutes.
5. **Sessions API** filters `starts_at >= now()` in PostgreSQL. `starts_at` = play date + start time in Asia/Ho_Chi_Minh, computed at insert; sessions without a date or start time have `NULL` and are never listed.
6. **Frontend** fetches same-origin `/api/v1/sessions` every 60 s and on tab focus. Between fetches it also hides cards whose start has passed, using the server's clock offset (`meta.serverTime`) rather than trusting the device clock.

## Deduplication

| Layer | Key | Purpose |
|---|---|---|
| Content script | DOM element + post key | Don't re-extract on every mutation |
| Background | `sentKeys` (last 5 000) + outbox keys | Don't resubmit after each 3-minute reload |
| PostgreSQL | unique `(coalesce(group_id,''), facebook_post_id)` where ID present; unique `fingerprint` where ID absent | Authoritative, race-safe |

Post key = `id:<group>:<postId>` when the ID is known, otherwise `fp:<sha256>`. These are separate namespaces. The server computes its own fingerprint (sha256 of group + author + normalized content) and never trusts the client's. When a post first stored without an ID shows up again with one, the existing row gains the ID instead of creating a duplicate. An advisory lock on the fingerprint serializes concurrent submissions of the same post.

## Claude serializer (`backend/src/ai/`)

- Model `claude-haiku-5-5`, effort `low`, structured output via `messages.parse` + `zodOutputFormat`.
- The system prompt is static and cached (`cache_control`). The per-post user message holds the reference time and a 14-day weekday calendar, so the model resolves "thứ 7", "mai" or "tuần sau" by lookup rather than doing date arithmetic.
- Post text is wrapped in `<post>` tags and treated as untrusted data.
- The model returns only `relevant` plus per-session `playDate/startTime/endTime/level/location`. Author and content always come from the captured post. Output is normalized (`19h` → `19:00`) and validated; implausible dates become `null` instead of being guessed.
- One post can produce several sessions (e.g. a weekly schedule). A relevant post with no usable details is kept as one all-null session, stored but not listed.
- Retry policy: 429/5xx/network/auth errors and unparseable output are retried; 400/404/422 and refusals fail immediately.

## Facebook DOM detection (`extension/src/crawler/`)

The feed is `[role="feed"]`; each direct child is a candidate. A candidate is a post only if it is rendered (not a `data-virtualized="true"`, `aria-busy` or empty placeholder), has an author heading (`h2`/`h3`/`h4`) outside any comment, and has post text or a post permalink. Sorting controls and skeletons fail these checks.

`[role="article"]` is **not** treated as the post: any article inside the container other than the one wrapping the author header is a comment or reply. Comment text, comment permalinks (`comment_id`, `reply_comment_id`), links inside the post body, composers and UI labels ("Thích", "3 bình luận") are excluded.

Text comes from the `[data-ad-preview="message"]` block when present, otherwise from top-level `div[dir="auto"]` blocks before the action bar. Extraction is layout-free (works in jsdom): blocks and `<br>` become line breaks, emoji `<img>` keep their alt text, and "Xem thêm" toggles and Facebook's truncation ellipsis are dropped. Before extracting, the monitor clicks "Xem thêm" once and hovers lazy timestamp links once so Facebook fills in the full text and the permalink.

## Monitoring state (`extension/src/monitor/scheduler.ts`)

One `MonitorState` per tab in `chrome.storage.local`, plus one `chrome.alarms` alarm per monitor for refreshes.

| Event | Handling |
|---|---|
| Page (re)load | Content script sends `hello`; background replies whether to activate |
| SPA navigation away / back | Monitor becomes `paused` / `active` |
| Tab closed | Monitor removed (kept `dormant` if the whole browser is closing) |
| Browser restart | Stale tab IDs become `dormant`; rebound by group URL on startup or when the group is opened again |
| Refresh alarm | Skipped while a reload is in flight (90 s lock), while the tab is loading, or while the user is typing or recently interacted |
