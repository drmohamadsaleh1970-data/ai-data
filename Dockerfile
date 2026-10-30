FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
COPY scripts ./scripts
ENV NODE_ENV=production PORT=3000 DB_FILE=/data/aihome.db EXPORT_DIR=/data/exports
VOLUME /data
EXPOSE 3000
CMD ["sh", "-c", "node --no-warnings scripts/migrate.js && node --no-warnings server/index.js"]
