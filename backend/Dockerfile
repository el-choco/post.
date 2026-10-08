FROM node:24-alpine
LABEL org.opencontainers.image.title="post. Webmail Backend" \
      org.opencontainers.image.description="IMAP/SMTP webmail API with persistent SQLite storage"
ENV NODE_ENV=production DATA_DIR=/app/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN apk add --no-cache libstdc++ \
    && apk add --no-cache --virtual .build-deps python3 make g++ \
    && npm ci --omit=dev \
    && apk del .build-deps \
    && mkdir -p /app/data && chown node:node /app/data
COPY --chown=node:node src ./src
USER node
EXPOSE 3000
CMD ["node", "src/index.js"]
