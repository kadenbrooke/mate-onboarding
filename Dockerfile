# Mate (mate.auto-mate.business) as a self-hosted `next start` container, for KVM2 while the
# Vercel team is paused (until 2026-12-11). Build from the repository root;
# deploy/kvm2/docker-compose.yml does this and passes the build args:
#   docker build --build-arg NEXT_PUBLIC_MATE_URL=https://mate.auto-mate.business \
#     --build-arg NEXT_PUBLIC_SUPABASE_URL=... --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... -t mate:local .
# NEXT_PUBLIC_* values are inlined into the bundles at build time, so they are build args. The
# publishable key is public by design (every browser gets it). Every other setting (Supabase
# secret key, cron secret, OAuth and Telnyx keys) comes from the env file at run time and never
# enters the image.
ARG NODE_IMAGE=node:22.23.3-alpine

FROM ${NODE_IMAGE} AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# Every dependency, for the build.
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Runtime dependencies only (next, react, supabase, sharp for next/image, ...). The lockfile
# carries sharp's linuxmusl-x64 and linuxmusl-arm64 binaries, so npm ci picks the right one.
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

FROM deps AS build
ARG NEXT_PUBLIC_MATE_URL=https://mate.auto-mate.business
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_MATE_URL=${NEXT_PUBLIC_MATE_URL} \
    NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL} \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY} \
    NODE_OPTIONS=--max-old-space-size=1536
COPY . .
# A build without the Supabase values would ship a browser bundle that cannot sign anyone in.
RUN test -n "$NEXT_PUBLIC_SUPABASE_URL" && test -n "$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" \
      || { echo "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY build args are required" >&2; exit 1; }
RUN npm run build

FROM ${NODE_IMAGE} AS run
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NODE_OPTIONS=--max-old-space-size=512
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/public ./public
COPY --from=build /app/.next ./.next
# The node image's unprivileged user. Everything above stays root-owned and read-only to it; the
# only writable paths are the tmpfs mounts in deploy/kvm2/docker-compose.yml (.next/cache, /tmp).
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/login || exit 1
CMD ["node", "node_modules/next/dist/bin/next", "start"]
