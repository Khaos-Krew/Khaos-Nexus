FROM node:22-alpine
WORKDIR /app

COPY services/veyra/discord-gateway/package.json ./
RUN npm install --omit=dev

COPY services/veyra/discord-gateway/src ./src

ENV NODE_ENV=production
CMD ["node", "src/index.js"]
