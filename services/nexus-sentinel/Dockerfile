FROM node:22-alpine AS build
WORKDIR /app
COPY services/nexus-sentinel/package*.json ./
RUN npm install
COPY services/nexus-sentinel/tsconfig.json ./
COPY services/nexus-sentinel/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY services/nexus-sentinel/health-server.mjs ./health-server.mjs
CMD ["node", "--import", "./health-server.mjs", "dist/index.js"]
