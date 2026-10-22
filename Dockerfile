# Container image for AWS (ECS Fargate). One image serves both services:
#   SERVICE=api         portal API         (default)
#   SERVICE=activation  license activation
# See server/main.ts and docs/plans/aws-migration.md.
# Migrations: run `bun run server/migrate.ts` as a one-off task (same image,
# same SERVICE value) before rolling out a new version.

FROM oven/bun:1.4.0 AS deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml .npmrc ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4.0-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    SERVICE=api

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
COPY server ./server
COPY migrations ./migrations

# Run as the unprivileged user shipped in the Bun image.
USER bun
EXPOSE 8080

# Liveness only; ECS and the ALB also health-check /healthz from outside.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT ?? 8080) + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["bun", "run", "server/main.ts"]
