# Telvey web (public site + /app WebApp/PWA + /admin console) — Next.js standalone, non-root.
# Build from the repo root (needs /assets, /fixtures, /benchmark/replay and packages/core):
#   docker build -f apps/web/Dockerfile -t telvey-web \
#     --build-arg NEXT_PUBLIC_API_BASE_URL=https://api.example.com .
# NEXT_PUBLIC_* values are inlined into the browser bundle at BUILD time, so they must be build
# args (runtime env has no effect on them). Never pass secrets here: only public, restricted keys.
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter "@city/web..."
ARG NEXT_PUBLIC_API_BASE_URL=""
ARG NEXT_PUBLIC_SITE_URL=""
ARG NEXT_PUBLIC_GOOGLE_MAPS_WEB_KEY=""
ARG NEXT_PUBLIC_MAP_STYLE_URL=""
ARG NEXT_PUBLIC_ANDROID_TEST_URL=""
ARG NEXT_PUBLIC_IOS_TEST_URL=""
ARG NEXT_PUBLIC_EARLY_ACCESS_URL=""
ARG NEXT_PUBLIC_CONTACT_EMAIL=""
ARG BUILD_SHA=dev
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_GOOGLE_MAPS_WEB_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_WEB_KEY \
    NEXT_PUBLIC_MAP_STYLE_URL=$NEXT_PUBLIC_MAP_STYLE_URL \
    NEXT_PUBLIC_ANDROID_TEST_URL=$NEXT_PUBLIC_ANDROID_TEST_URL \
    NEXT_PUBLIC_IOS_TEST_URL=$NEXT_PUBLIC_IOS_TEST_URL \
    NEXT_PUBLIC_EARLY_ACCESS_URL=$NEXT_PUBLIC_EARLY_ACCESS_URL \
    NEXT_PUBLIC_CONTACT_EMAIL=$NEXT_PUBLIC_CONTACT_EMAIL \
    NEXT_PUBLIC_BUILD_SHA=$BUILD_SHA
RUN pnpm --filter @city/web typecheck && pnpm --filter @city/web build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /srv
# Standalone output keeps the monorepo layout (outputFileTracingRoot = repo root).
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/robots.txt').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
