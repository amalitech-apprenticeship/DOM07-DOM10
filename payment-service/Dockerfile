# Payment service image. Same base as app/Dockerfile, but one stage is
# enough: there are no native modules (like better-sqlite3), so no compilers.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

# Install production dependencies first, so this layer is cached until
# package.json or package-lock.json change.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# Run as the unprivileged "node" user that comes with the official image.
# The service writes no files, so it needs no write permissions.
USER node

EXPOSE 4000
CMD ["node", "src/server.js"]
