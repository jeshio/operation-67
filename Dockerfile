FROM node:26.12.0-alpine@sha256:6f08a523443ddedf52941874c203475b0ad503e859ad70cb26ab8be9a517dbd5 AS build
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
FROM node:26.12.0-alpine@sha256:6f08a523443ddedf52941874c203475b0ad503e859ad70cb26ab8be9a517dbd5
WORKDIR /game
ENV NODE_ENV=production HOST=0.0.0.0 PORT=5179
COPY --from=build /runtime ./
USER node
EXPOSE 5179
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O - http://127.0.0.1:5179/ready || exit 1
CMD ["node", "dist-server/index.js"]
