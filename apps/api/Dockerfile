FROM oven/bun:1.3-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock* ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
RUN bun install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .
WORKDIR /app/apps/api
RUN bun run build

FROM base AS runner

ARG PACKAGE_VERSION=untagged
ARG GIT_HASH=unspecified
ARG NODE_ENV=production

LABEL maintainer="Chris Lee"
LABEL com.personalclaw.api.package-version=${PACKAGE_VERSION}
LABEL com.personalclaw.api.node-env=${NODE_ENV}
LABEL com.personalclaw.api.git-hash=${GIT_HASH}

WORKDIR /app/apps/api
ENV NODE_ENV=${NODE_ENV}

RUN apk add --no-cache curl aws-cli github-cli bubblewrap git jq python3 py3-pip nodejs npm

RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 appuser && \
    mkdir -p /home/appuser/.aws && \
    chown appuser:appgroup /home/appuser/.aws && \
    mkdir -p /tmp/personalclaw-sandbox && \
    chown appuser:appgroup /tmp/personalclaw-sandbox

COPY --from=builder --chown=appuser:appgroup /app/apps/api/dist ./dist
USER appuser
EXPOSE 4000
CMD ["bun", "run", "dist/index.js"]
