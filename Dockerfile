FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev --prefer-offline

COPY public ./public
COPY server ./server
COPY scripts ./scripts
COPY docs ./docs

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV TRUST_PROXY=1

EXPOSE 10000

CMD ["sh", "-c", "API_PORT=${PORT:-10000} node server/index.js"]
