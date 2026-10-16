# QBadminton

Collects badminton player-recruitment posts (bài tuyển vãng lai cầu lông) from Facebook groups you already have open, turns them into structured sessions with Claude, and lists upcoming sessions at **https://qbadminton.quanphung.space**.

```
Facebook group tab (logged in) ─► Chrome extension (WXT) ─► POST /api/v1/posts/ingest
      ─► Fastify backend ─► raw_posts (PostgreSQL, dedup + job queue)
      ─► worker ─► Claude (claude-haiku-5-5) ─► badminton_sessions
      ─► GET /api/v1/sessions ─► React site (nginx) ─► Cloudflare Tunnel ─► public URL
```

| Folder | App | Stack |
|---|---|---|
| `backend/` | API + background worker | Node 24, Fastify 5, Drizzle ORM, Zod 4, Anthropic SDK |
| `frontend/` | Public read-only listing | React 19, Vite 7, Tailwind 4, served by nginx |
| `extension/` | Group monitor | WXT, Manifest V3, TypeScript |

Each app has its own `package.json` and runs independently; they talk only over REST. More detail: [docs/architecture.md](docs/architecture.md), [docs/deployment.md](docs/deployment.md).

## Run it (this machine)

```bash
cp .env.example .env            # then fill in the secrets (see below)
docker compose up -d --build    # postgres + backend + web
docker compose ps               # all three should be "healthy"
```

- Site: http://localhost:8082 → public at https://qbadminton.quanphung.space
- Raw data (owner only): `/raw`, 30 posts per page, unlocked with `INGEST_API_KEY`
- Health: http://localhost:8082/health
- PostgreSQL is not published to the host; the backend is only reachable through nginx.
- Database migrations run automatically when the backend starts.

To enable AI parsing, put your key in `.env` and recreate the backend:

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-...
docker compose up -d backend
```

Without a key, posts are still stored and stay `pending`; they're processed as soon as the key is set.

## Chrome extension

```bash
cd extension
npm install
npm run build                   # output: extension/.output/chrome-mv3
```

1. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick `extension/.output/chrome-mv3`.
2. Click the extension icon → **Cài đặt kết nối**: Backend URL `http://localhost:8082` (the default) and the `INGEST_API_KEY` value from `.env`. Click **Lưu**; the badge should read *Máy chủ OK*.
3. Open a Facebook group you're a member of. Optionally click **Chuyển nhóm sang sắp xếp “Bài viết mới”** so new posts load first.
4. Click **Bắt đầu theo dõi**. The tab is scanned immediately and on every DOM change, and reloaded every 3 minutes (adjustable from 1 to 60). Several group tabs can be monitored at once.

The extension never opens tabs, navigates between groups, or reads cookies or tokens. It skips a reload while you're typing in the tab or have interacted with it in the last 30 seconds.

`npm run dev` starts WXT's dev mode with a temporary Chrome profile (you'd need to log in to Facebook there).

## Development

```bash
docker compose -f docker-compose.dev.yml up -d   # dev Postgres on 127.0.0.1:5434

cd backend && npm install
cp .env.example .env            # set INGEST_API_KEY (and ANTHROPIC_API_KEY if you want parsing)
npm run db:migrate
npm run dev                     # http://localhost:3000

cd frontend && npm install
npm run dev                     # http://localhost:5173, proxies /api and /health to :3000
```

| | backend | frontend | extension |
|---|---|---|---|
| Typecheck | `npm run typecheck` | `npm run typecheck` | `npm run typecheck` |
| Tests | `npm test` | `npm test` | `npm test` |
| Build | `npm run build` | `npm run build` | `npm run build` |

Backend tests run against real PostgreSQL semantics (in-process PGlite with the production migrations); Claude is always mocked. The extension tests use `extension/tests/fixtures/facebook-group.html`. An optional live check sends fixture posts to a running backend; point it at a dev instance, not production:

```bash
cd extension
QB_E2E_BACKEND_URL=http://localhost:3000 QB_E2E_API_KEY=<backend INGEST_API_KEY> npm test
```

Schema changes: edit `backend/src/database/schema.ts`, run `npm run db:generate`, and commit the new file in `backend/drizzle/`.

## Configuration

Root `.env` (read by `docker-compose.yml`):

| Variable | Required | Purpose |
|---|---|---|
| `POSTGRES_PASSWORD` | yes | Database password. Use URL-safe characters (it's embedded in `DATABASE_URL`). |
| `INGEST_API_KEY` | yes | Shared secret for the extension (≥ 24 chars). |
| `ANTHROPIC_API_KEY` | for parsing | Claude API key; never sent to clients. |
| `CLAUDE_MODEL` | no | Default `claude-haiku-5-5`. |
| `WEB_PORT` | no | Loopback port for the site, default `8082` (the tunnel points here). |
| `POSTGRES_DB`, `POSTGRES_USER`, `LOG_LEVEL` | no | Defaults `qbadminton`, `qbadminton`, `info`. |

Backend tuning (see `backend/.env.example`): `WORKER_CONCURRENCY` (2), `JOB_MAX_ATTEMPTS` (5), `JOB_BACKOFF_BASE_MS` (30 s), `JOB_BACKOFF_MAX_MS` (30 min), `JOB_STALE_AFTER_MS` (10 min), `WORKER_POLL_INTERVAL_MS` (5 s).

Extension default backend: `WXT_BACKEND_URL` in `extension/.env` at build time; otherwise it's set in the popup.

## API

| Method | Path | Auth | Notes |
|---|---|---|---|
| `POST` | `/api/v1/posts/ingest` | `Authorization: Bearer <INGEST_API_KEY>` | `{ posts: RawFacebookPost[] }`, 1–50 per call; idempotent |
| `GET` | `/api/v1/sessions` | – | Upcoming only, nearest first. Query: `date=YYYY-MM-DD`, `level=TB,TB_PLUS` (any of the six level codes), `timeFrom` / `timeTo` (`HH:mm`, inclusive window on the start time; from > to wraps past midnight), `location` (accent-insensitive), `limit` ≤ 200, `offset` |
| `GET` | `/api/v1/sessions/:id` | – | Any session, including past ones |
| `GET` | `/api/v1/posts` | `Authorization: Bearer <INGEST_API_KEY>` | Raw captured posts, newest first. Query: `page`, `pageSize` (default 30, ≤ 100), `status`. Shown at `/raw` on the site |
| `GET` | `/health` | – | `{ status, database }` |

Responses are `{ success: true, data, meta? }` or `{ success: false, error: { code, message, details? } }`.

## Operations

```bash
docker compose logs -f backend                                  # structured JSON logs (worker included)
docker compose exec backend node dist/database/migrate.js       # run migrations manually
docker compose exec postgres psql -U qbadminton -d qbadminton   # SQL shell
docker compose exec postgres pg_dump -U qbadminton qbadminton > backup.sql
# Retry posts that exhausted their attempts (e.g. after fixing the API key):
docker compose exec backend node dist/jobs/requeue-failed.js
```

Skill levels: each session links to one or more of exactly six levels (`skill_levels` table, `session_levels` join), derived in code from the level text: Y/Yếu (any signs) → `YEU`; TBY/trung bình yếu → `TBY`; TB- → `TB_MINUS`; TB/trung bình/TB nhỉnh → `TB`; TB+/TBK → `TB_PLUS`; Khá (any signs) → `KHA`. Ranges are not expanded (users multi-select instead). After changing the rules in `backend/src/lib/levels.ts`, recompute existing sessions:

```bash
docker compose exec backend node dist/jobs/rebuild-levels.js
```

Processing statuses in `raw_posts.processing_status`: `pending` → `processing` → `parsed` | `duplicate` | `irrelevant` | `failed`.

Duplicate sessions: after AI parsing, a session is skipped when a stored one has the same author, normalized level set, location (accent/case-insensitive) and play date + start + end time. A post whose sessions were all skipped becomes `duplicate` (`duplicate_of_post_id` points at the earlier post). To remove duplicates stored earlier:

```bash
docker compose exec backend node dist/jobs/dedupe-sessions.js
```

Data retention: the backend deletes old data every `CLEANUP_INTERVAL_HOURS` (48) hours, keeping `CLEANUP_RETENTION_DAYS` (2) days. It removes sessions that started before the cutoff (or, without a start time, were created before it) and raw posts captured before the cutoff that have no session left; a post with an upcoming session is kept. The last run is recorded in `maintenance_runs`, so restarts don't repeat or skip a run. Set `CLEANUP_ENABLED=false` to keep history. To run it immediately:

```bash
docker compose exec backend node dist/jobs/cleanup-old-data.js
```

## Known limitations

- **Facebook DOM drift.** Detection uses structure and ARIA roles rather than class names, but Facebook changes its markup. The test fixture is synthetic, built from the observed DOM signals. Save a real group page into `extension/tests/fixtures/` and re-run the tests to check against current markup.
- **Post IDs and timestamps are best effort.** Facebook often fills in permalink hrefs only on hover and shows relative times ("2 giờ"). When no ID is found, the post is deduplicated by content fingerprint. `publishedAt` stays `null` when unreadable, and Claude then resolves "tối nay" against the capture time.
- **Only loaded posts are seen.** The extension doesn't scroll; each refresh captures what Facebook renders at the top of the feed (use "Bài viết mới" sorting).
- **AI parsing needs `ANTHROPIC_API_KEY`.** Parsing quality on real posts hasn't been measured yet; automated tests mock Claude.
- **Public data.** Author names and post text from the monitored groups are shown on a public website. Only monitor groups where that's acceptable.
