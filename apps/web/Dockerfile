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
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .
WORKDIR /app/apps/web
ENV DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder
RUN bun run build

FROM base AS runner

ARG PACKAGE_VERSION=untagged
ARG GIT_HASH=unspecified
ARG NODE_ENV=production

LABEL maintainer="Chris Lee"
LABEL com.personalclaw.web.package-version=${PACKAGE_VERSION}
LABEL com.personalclaw.web.node-env=${NODE_ENV}
LABEL com.personalclaw.web.git-hash=${GIT_HASH}

WORKDIR /app
ENV NODE_ENV=${NODE_ENV}
RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 appuser
COPY --from=builder --chown=appuser:appgroup /app/apps/web/.next/standalone ./
COPY --from=builder --chown=appuser:appgroup /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=appuser:appgroup /app/apps/web/public ./apps/web/public
USER appuser
EXPOSE 3000
WORKDIR /app/apps/web
CMD ["bun", "run", "server.js"]
