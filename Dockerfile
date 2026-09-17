FROM node:26.8-alpine@sha256:ef24c5053d50fdc3e4e56eb4e7ddb7861874ab0fdc797046ba897581deb8e868 AS build
WORKDIR /game
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile --ignore-scripts && pnpm rebuild esbuild
COPY src ./src
COPY server ./server
COPY public ./public
COPY scripts/security ./scripts/security
COPY scripts/package-vps.mjs ./scripts/package-vps.mjs
COPY index.html tsconfig.json ./
ARG RELEASE_COMMIT
ARG RELEASE_DIRTY=true
RUN RELEASE_COMMIT="$RELEASE_COMMIT" RELEASE_DIRTY="$RELEASE_DIRTY" pnpm build && pnpm security:artifact && node scripts/package-vps.mjs /runtime.tar.gz --allow-dirty && mkdir /runtime && tar -xzf /runtime.tar.gz -C /runtime
FROM node:26.8-alpine@sha256:ef24c5053d50fdc3e4e56eb4e7ddb7861874ab0fdc797046ba897581deb8e868
WORKDIR /game
ENV NODE_ENV=production HOST=0.0.0.0 PORT=5179
COPY --from=build /runtime ./
USER node
EXPOSE 5179
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O - http://127.0.0.1:5179/ready || exit 1
CMD ["node", "dist-server/index.js"]
