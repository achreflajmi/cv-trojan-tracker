# Runner image for the scheduled measurement (Stage 8). Field by field:
#
# FROM: official Node 24 on Debian bookworm, "slim" variant (no compilers, smaller
#   attack surface). Multi-arch: the same tag works for amd64 (local) and arm64 (AWS
#   Graviton). For a release build, pin the digest too (node:24-bookworm-slim@sha256:...).
FROM node:24-bookworm-slim

# poppler-utils: pdftotext/pdftoppm for the extractor. ca-certificates: TLS to the APIs.
# --no-install-recommends + removing apt lists keeps the image small.
RUN apt-get update \
 && apt-get install -y --no-install-recommends poppler-utils ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Amazon RDS CA bundle, so the Postgres connection verifies the server certificate
# (the pool uses ssl.rejectUnauthorized = true). Node adds it to its default CAs.
# --chmod=644: ADD of a URL creates a root-only (600) file; the app runs as "node".
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem \
    NODE_ENV=production \
    PDFTOTEXT_PATH=/usr/bin/pdftotext

WORKDIR /app

# corepack provides the exact pnpm version pinned in package.json (packageManager).
RUN corepack enable

# 1) Manifests first: this layer (dependency install) is cached until a manifest changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/corpus/package.json packages/corpus/
COPY packages/extract/package.json packages/extract/
COPY packages/providers/package.json packages/providers/
COPY packages/db/package.json packages/db/
COPY packages/engine/package.json packages/engine/
COPY apps/cli/package.json apps/cli/
COPY apps/web/package.json apps/web/

# Only the CLI and its workspace dependencies, production only.
#   --frozen-lockfile: fail instead of resolving new versions (reproducible).
#   --ignore-scripts: no install scripts run (supply chain; the git-hook script needs git).
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter "@ctt/cli..."

# 2) Source and the inputs the experiments need. Node 24 runs the .ts files directly.
COPY packages/ packages/
COPY apps/cli/ apps/cli/
COPY config/ config/
COPY battery/ battery/

# Run as the unprivileged "node" user that the base image provides, never root.
USER node

# The task definition overrides the command (migrate + run); this default prints usage.
CMD ["node", "apps/cli/src/main.ts"]
