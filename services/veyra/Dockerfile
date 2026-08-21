FROM node:22-alpine
WORKDIR /app

COPY packages/ai/dnd-ai/package*.json ./
RUN npm install --omit=dev

COPY packages/ai/dnd-ai ./

ENV NODE_ENV=production
CMD ["node", "src/index.js"]
