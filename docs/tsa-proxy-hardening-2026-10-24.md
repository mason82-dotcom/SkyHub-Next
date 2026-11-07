# TSA reverse-proxy hardening (2026-10-24)

This focused change ports the narrow TSA security/reconnect fix from [PR #28](https://github.com/mason82-dotcom/SkyHub-Next/pull/28) to the current `main`. It does not import that PR's older SkyHub-MinIO ancestry or [PR #29](https://github.com/mason82-dotcom/SkyHub-Next/pull/29).

## Runtime contract

- `SKYHUB_DJI_TSA_ENABLED=false` remains the default. Pilot public origin must be a plain HTTPS origin.
- `SKYHUB_DJI_TSA_TRUSTED_PROXY_IPS` enumerates **exact socket peers** (IP literals only), up to eight, default `127.0.0.1,::1`. An entire private LAN / Docker subnet is never trusted automatically.
- Requests for the TSA topology GET and `/ws/tsa` are trusted only when the immediate socket peer matches the allowlist and `X-Forwarded-Proto` is exactly `https`. Comma-separated or conflicting values fail closed.
- A newly attached authenticated TSA client receives only already-processed and still-fresh position updates, without replay to other clients.
- The TSA WebSocket token is conveyed in a URL query string by DJI Pilot 2. **A successful HTTPS connection does not protect this token from application/proxy access logs**: the proxy must explicitly redact or suppress query strings. This change does **not** install or modify Caddy rules.
- The opt-in frontend endpoints are read-only. A CI pass does not prove real Pilot 2 interoperability or authorize flight missions.

## Raspberry Pi 5: safe inspection only

```bash
cd ~/Projekte/SkyHub-Next || exit 1
git remote -v
git status --short --branch
git fetch origin
git log -1 --oneline origin/main
node --test backend/test/pilot-config.test.js backend/test/tsa-hub.test.js
docker compose --env-file .env.example config --quiet
```

These commands do not restart containers or change MQTT/MinIO. If Docker Compose reports undefined local secrets, fix configuration offline rather than copying live credentials into committed files. For hardware acceptance, separately verify the **actual** immediate proxy peer address from inside the backend container, the WSS/HTTPS TLS chain, query-token redaction, and DJI Pilot 2 JSBridge behavior before setting `SKYHUB_DJI_TSA_ENABLED=true`.

## Merge criteria

A new GitHub CI run for the exact head commit must pass, including the isolated PostGIS jobs and Docker Compose checks. Keep the linked legacy PR as historical context rather than auto-merging stacked ancestry.
