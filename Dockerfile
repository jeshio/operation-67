FROM node:22-alpine AS build
WORKDIR /game
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod
FROM node:22-alpine
WORKDIR /game
ENV NODE_ENV=production HOST=0.0.0.0 PORT=5179
COPY --from=build /game/package.json ./
COPY --from=build /game/node_modules ./node_modules
COPY --from=build /game/dist ./dist
COPY --from=build /game/dist-server ./dist-server
USER node
EXPOSE 5179
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O - http://127.0.0.1:5179/health || exit 1
CMD ["node", "dist-server/index.js"]
