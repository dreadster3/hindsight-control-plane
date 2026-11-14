# The standalone Hindsight control plane (Next.js) as a deployable image.
#
# Upstream ships no control-plane Dockerfile, so this is the standard Next.js
# standalone recipe adapted to this repo's vendored SDK:
#   - `output: "standalone"` (next.config.ts) emits .next/standalone/server.js
#     with a traced node_modules; static assets and public/ are copied beside it.
#   - vendor/hindsight-client is a `file:` dependency npm SYMLINKS into
#     node_modules, so the vendor sources must live at the same relative path
#     during the build. `npm run build` runs its prebuild step (tsc + esbuild
#     plugin) before `next build`; typescript/esbuild resolve from the root
#     node_modules, so no separate install inside vendor/ is needed.
#
# Build from the repository root (vendor/ and public/ must be in the context):
#   docker build -f deploy/Dockerfile -t hindsight-control-plane:dev .
#
# Run (all configuration is runtime environment — the standalone server does
# NOT read .env files, which is what you want in a container):
#   docker run -p 9999:9999 \
#     -e HINDSIGHT_CP_DATAPLANE_API_URL=https://hindsight.example.com \
#     -e AUTH_SECRET=$(openssl rand -base64 32) \
#     -e AUTH_AUTHENTIK_ISSUER=https://authentik.example.com/application/o/hindsight/ \
#     -e AUTH_AUTHENTIK_ID=... -e AUTH_AUTHENTIK_SECRET=... \
#     -e AUTH_URL=https://controlplane.example.com \
#     hindsight-control-plane:dev
# Without the AUTH_* variables the image runs in legacy access-key mode
# (HINDSIGHT_CP_ACCESS_KEY + HINDSIGHT_CP_DATAPLANE_API_KEY).
#
# Probes: use /api/version (always 200) for liveness/readiness — /api/health
# deliberately returns 503 in OIDC mode until a session exists.
#
# Base image pinned by tag, not digest: the build environment that authored
# this file could not reach Docker Hub to resolve the digest. Pin
# node:22-alpine@sha256:... here once resolved, matching the digest-pinning
# convention of the sibling hindsight-hybrid-authentication repo.
FROM node:22-alpine AS build
WORKDIR /app

# Install first so source edits don't re-resolve dependencies. The vendored
# SDK's manifest must exist before `npm ci` because the lockfile references it
# as a file: dependency.
COPY package.json package-lock.json ./
COPY vendor/hindsight-client/package.json ./vendor/hindsight-client/
RUN npm ci

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=9999 \
    HOSTNAME=0.0.0.0

# The node:alpine image ships an unprivileged `node` user.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node

EXPOSE 9999
CMD ["node", "server.js"]