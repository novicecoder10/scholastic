# Self-hosting image. Multi-stage so the runtime carries the standalone server
# bundle rather than node_modules and a toolchain.

FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
COPY scripts/copy-pdf-worker.mjs ./scripts/
# The postinstall script copies the pdf.js worker out of the installed
# pdfjs-dist so the two can never drift apart; it needs to run here.
RUN pnpm install --frozen-lockfile

FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Migrations and the runner are needed to bring a fresh database up:
#   docker run --rm -e DATABASE_URL=... <image> node_modules/.bin/tsx src/lib/db/migrate.ts
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/db/migrations ./src/lib/db/migrations

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
