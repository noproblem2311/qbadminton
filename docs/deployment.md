# Deployment on this machine

## Layout

| Container | Network exposure | Data |
|---|---|---|
| `qbadminton-web-1` (nginx + built SPA) | `127.0.0.1:8082 → 80` only | none |
| `qbadminton-backend-1` (Fastify + worker) | internal network only | none (secrets via env) |
| `qbadminton-postgres-1` (PostgreSQL 16) | internal network only | volume `qbadminton-postgres-data` |

Compose project `qbadminton` is isolated from the existing `qsmart-*` projects (own network, volume and port). Restart policy: `unless-stopped`; all three containers have health checks.

nginx routes `/` to the SPA (with history fallback), and `/api/*` and `/health` to `backend:3000`. It re-resolves the backend through Docker DNS, so backend restarts don't break proxying.

## Cloudflare Tunnel

The host already runs the `cloudflared` Windows service (`tunnel run --token-file C:\ProgramData\cloudflared\token`). It is a **remotely managed** tunnel: public hostnames are configured in the Cloudflare Zero Trust dashboard, not in a local `config.yml`. The tunnel is shared with the other apps on this machine:

| Hostname | Service |
|---|---|
| `temp.quanphung.space` | `http://localhost:8080` (qsmart-temporary) |
| `dev.qsmart.quanphung.space` | `http://localhost:8081` (qsmart-dev) |
| `qbadminton.quanphung.space` | `http://localhost:8082` (this app) |

The qbadminton route was added in the dashboard; no second tunnel was created and no existing route was changed.

**HTTPS:** Cloudflare terminates TLS. The zone does not force HTTPS, so nginx redirects requests that arrive with `X-Forwarded-Proto: http` to HTTPS and sends `Strict-Transport-Security`. Direct loopback requests (no such header) are not redirected. To enforce this at the edge as well, enable *SSL/TLS → Edge Certificates → Always Use HTTPS* for `quanphung.space`; note that this setting is zone-wide.

## Verify

```bash
docker compose ps
curl -s http://localhost:8082/health
curl -s https://qbadminton.quanphung.space/health
curl -s https://qbadminton.quanphung.space/api/v1/sessions
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://qbadminton.quanphung.space/api/v1/posts/ingest   # 401
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://qbadminton.quanphung.space/                 # 301 → https
```

## Update

```bash
git pull
docker compose up -d --build     # migrations run on backend start
```

## Security notes

- Only the ingest endpoint accepts writes, and it requires `INGEST_API_KEY`. The rest of the public API is read-only, and there are no admin endpoints.
- `ANTHROPIC_API_KEY` exists only in the backend container's environment.
- PostgreSQL has no published port. For a SQL shell use `docker compose exec postgres psql …`.
- Rotate `INGEST_API_KEY` by editing `.env`, running `docker compose up -d backend`, and updating the extension popup.
