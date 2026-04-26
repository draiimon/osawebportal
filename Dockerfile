FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY public ./public
COPY server ./server
COPY docker-entrypoint.sh ./

RUN chmod +x docker-entrypoint.sh

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV TRUST_PROXY=1

EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-10000}/api/v1/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
