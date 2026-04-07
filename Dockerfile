# Stage 1: Builder
FROM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Generate Prisma client
RUN npx prisma generate

ENV NEXT_TELEMETRY_DISABLED=1

# ビルド時はダミーのDATABASE_URLを設定（実際の接続はRuntime時にSecret Managerから取得）
ENV DATABASE_URL="postgresql://dummy:dummy@localhost/dummy"

RUN npm run build

# Stage 2: Runner
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone output (includes necessary node_modules)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 8080

CMD ["node", "server.js"]
