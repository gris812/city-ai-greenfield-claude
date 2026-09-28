# Telvey API — multi-stage, non-root. Build from the repo root:
#   docker build -f apps/api/Dockerfile -t telvey-api .
FROM node:22-bookworm-slim AS deps
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter "@city/api..."

FROM deps AS check
RUN pnpm --filter "@city/api..." typecheck

FROM node:22-bookworm-slim AS runtime
ARG BUILD_SHA=dev
ENV NODE_ENV=production PORT=8080 AUDIO_DIR=/data/audio BUILD_SHA=${BUILD_SHA}
WORKDIR /repo
# Workspace sources + installed deps (tsx executes TypeScript directly; no build step to drift).
COPY --from=deps --chown=node:node /repo/package.json /repo/pnpm-workspace.yaml /repo/tsconfig.base.json ./
COPY --from=deps --chown=node:node /repo/node_modules ./node_modules
COPY --from=deps --chown=node:node /repo/packages ./packages
COPY --from=deps --chown=node:node /repo/apps/api ./apps/api
# Fixtures ship only for DEMO_MODE=1 (D-005); production code never imports them otherwise.
COPY --from=deps --chown=node:node /repo/fixtures ./fixtures
# `check` stage must pass for the image to build.
COPY --from=check /repo/package.json /tmp/.typechecked
RUN mkdir -p /data/audio && chown -R node:node /data
USER node
WORKDIR /repo/apps/api
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "src/server.ts"]
