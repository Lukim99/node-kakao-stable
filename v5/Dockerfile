FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY packages ./packages
RUN npm ci && npm run build

COPY scripts ./scripts
RUN mkdir -p /app/data && chown -R node:node /app
USER node

ENV BOT_CONTROL_HOST=0.0.0.0 \
    BOT_DATA_DIR=/app/data/members \
    BOT_STATE_PATH=/app/data/bot-state.json
EXPOSE 3000
CMD ["npm", "run", "bot:start"]
