FROM node:22-slim AS runtime
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
COPY docker-entrypoint.sh /usr/local/bin/
ENTRYPOINT ["docker-entrypoint.sh"]
