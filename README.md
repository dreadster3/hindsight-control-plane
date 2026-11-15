# Hindsight Control Plane (OIDC)

Standalone control plane for [Hindsight](https://github.com/vectorize-io/hindsight),
extracted from the upstream monorepo at commit `0b3f09229bc13820f961244238ca885fda674076`
and extended with **per-user OIDC login**: users sign in with your identity
provider (Authentik), and the banks they see are exactly the banks in their own
tenant schema — enforced by the API, not by UI filtering.

## How it works

```
browser ──cookie session──▶ Next.js API routes ──Bearer <user's IdP token>──▶ Hindsight API
                              (server-side proxy)                              │
                                                          HybridTenantExtension: verify JWT (JWKS)
                                                          → preferred_username/sub → schema user_<id>
                                                          → only that user's banks exist for this caller
```

- Login is OIDC authorization-code + PKCE via [NextAuth / Auth.js v5](https://authjs.dev)
  (`next-auth@beta`, built-in Authentik provider).
- The user's IdP access/refresh tokens live **only** in the encrypted, HttpOnly
  session cookie (JWE). They are never sent to the browser; every dataplane
  request is proxied server-side with the user's token attached
  (`src/lib/auth/dataplane-token.ts`).
- Expired access tokens are refreshed transparently (refresh-token rotation,
  one in-flight refresh per session). If refresh fails, the next request 401s
  and the browser returns to the login page.
- The API side needs the
  [hybrid-tenant extension](https://github.com/dreadster3/hindsight-hybrid-authentication):
  it verifies the same tokens and resolves identity → per-user PostgreSQL schema.
  Bank listing (`GET /v1/default/banks`) and every other endpoint are scoped to
  that schema, so guessing another user's bank id simply 404s.

### Auth modes

| Mode | Enabled when | Login | Dataplane credential |
|---|---|---|---|
| **OIDC** | `AUTH_AUTHENTIK_ISSUER` + `AUTH_AUTHENTIK_ID` + `AUTH_AUTHENTIK_SECRET` + `AUTH_SECRET` all set | "Sign in with Authentik" button | the logged-in user's IdP token |
| Access key (upstream behavior) | `HINDSIGHT_CP_ACCESS_KEY` set, no OIDC env | shared access-key form | shared `HINDSIGHT_CP_DATAPLANE_API_KEY` |
| Open (upstream behavior) | neither set | none | shared key if set, else unauthenticated |

## Configuration

### Control plane

| Variable | Required | Meaning |
|---|---|---|
| `HINDSIGHT_CP_DATAPLANE_API_URL` | no (default `http://localhost:8888`) | Hindsight API base URL |
| `AUTH_SECRET` | OIDC | Session-cookie encryption secret (`openssl rand -base64 32`) |
| `AUTH_AUTHENTIK_ISSUER` | OIDC | Authentik application issuer, e.g. `https://authentik.example/application/o/hindsight` — **must equal the API's `HINDSIGHT_API_TENANT_OAUTH_ISSUER`** |
| `AUTH_AUTHENTIK_ID` | OIDC | OAuth2 client ID of that Authentik application |
| `AUTH_AUTHENTIK_SECRET` | OIDC | OAuth2 client secret |
| `AUTH_TRUST_HOST` | behind a proxy | `true` — trust `X-Forwarded-Host`/`Proto` |
| `AUTH_URL` | optional | External URL incl. base path if you use one (e.g. `https://cp.example/hindsight`); otherwise inferred from the request |
| `HINDSIGHT_CP_ACCESS_KEY` | access-key mode | shared UI login key (ignored in OIDC mode) |
| `HINDSIGHT_CP_DATAPLANE_API_KEY` | access-key mode | shared dataplane key (unused in OIDC mode) |
| `NEXT_PUBLIC_BASE_PATH` | optional | serve under a subpath; set `AUTH_URL` to match |
| `PORT` | no (default `9999`) | dev server port |

### Hindsight API (hybrid-tenant extension)

The control plane's tokens must pass the extension's OAuth lane:

```sh
HINDSIGHT_API_TENANT_EXTENSION=hindsight_ext_hybrid_tenant:HybridTenantExtension
HINDSIGHT_API_TENANT_USERS=pi:<static-key-for-headless-clients>   # still required
HINDSIGHT_API_TENANT_OAUTH_ENABLED=true
HINDSIGHT_API_TENANT_OAUTH_ISSUER=https://authentik.example/application/o/hindsight
# optional: _OAUTH_AUDIENCE, _OAUTH_JWKS_URL, _OAUTH_GROUPS_ALLOWLIST
```

**Single-issuer constraint:** the extension validates exactly one issuer, so the
control plane and your MCP clients must use the **same Authentik application**.
On that application's OAuth2 provider:

1. Enable the **authorization-code** grant (for the control plane) alongside any
   device-code / client-credentials grants you already use.
2. Add the redirect URI `https://<control-plane-host>/api/auth/callback/authentik`
   (include the base path if you use one).
3. Keep signing at **RS256**; request scopes `openid profile email` (add `groups`
   if you use the extension's groups allowlist).
4. Enable **refresh tokens** so control-plane sessions survive access-token expiry.

If `HINDSIGHT_API_TENANT_OAUTH_AUDIENCE` is set, the control plane's tokens must
carry that audience — easiest is to leave it unset or use one shared application.

## Development

```sh
npm install          # builds nothing yet
npm run dev          # http://localhost:9999 (prebuild compiles the vendored SDK)
npm test             # vitest suite
npm run build        # production build (standalone output)
```

Vendored from the upstream monorepo so this repo stands alone:

- `vendor/hindsight-client` — the TypeScript SDK (`file:` dependency, built by `prebuild`).
- `vendor/api-reference` — snapshot of `memory_engine.py` + `openapi.json` used by
  the engine↔UI parity tests. Refresh them when pulling upstream changes.

## Security notes

- Tokens never reach the browser: the NextAuth `session` callback exposes
  identity only; API routes read the access token from the JWE cookie server-side.
- The edge proxy (`src/proxy.ts`) only decodes the session cookie — refresh and
  all dataplane calls happen in Node route handlers.
- Refresh is serialized per session (in-process lock) and settled results are
  cached briefly for requests still carrying the pre-rotation cookie. Authentik
  rotates refresh tokens, so concurrent refreshes with the same token would be
  rejected. **The lock is per-process: run a single control-plane replica.**
  With multiple replicas a rotation race can still occur; the loser's session
  is cleared and the user re-authenticates (silently while the IdP session lives).
- A failed refresh — token rejected by the IdP or the IdP unreachable — clears
  the session cookie so the browser returns to the login page, instead of
  passing the proxy gate while every dataplane call 401s.
- Keep the API's auth as the only gate — do not trust proxy-injected identity
  headers (see the hybrid-tenant extension's README).
## Docker

```bash
docker build -f deploy/Dockerfile -t hindsight-control-plane:dev .
docker run -p 9999:9999 --env-file .env hindsight-control-plane:dev
```

The image runs the Next.js standalone server as an unprivileged user on port
9999. All configuration is runtime environment (the standalone server does not
read `.env` files — pass them with `--env-file` or your orchestrator). Use
`/api/version` for liveness/readiness probes; `/api/health` returns 503 in OIDC
mode until a session exists. Run a single replica: the token-refresh lock is
in-process (see the OIDC notes above).

## Releases

Releases are automated with [release-please](https://github.com/googleapis/release-please):
merging conventional-commit PRs to `main` keeps a `chore(main): release X.Y.Z`
PR up to date; merging that PR tags `vX.Y.Z` and, in the same workflow run,
builds and pushes `ghcr.io/dreadster3/hindsight-control-plane` tagged `vX.Y.Z`,
`vX.Y`, `vX` and `latest`. Because the repo squash-merges, the **PR title** is
what feeds the changelog — keep it conventional (`feat: ...`, `fix: ...`).
No PATs are involved; the default `GITHUB_TOKEN` does everything. The GHCR
package is private on first push — make it public in the package settings if
it should be pullable without auth.
