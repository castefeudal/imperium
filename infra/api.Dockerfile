FROM node:22-slim
RUN corepack enable
WORKDIR /app
RUN apt-get update -qq && apt-get install -y -qq postgresql-client redis-tools && rm -rf /var/lib/apt/lists/*

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/database/package.json packages/database/
COPY packages/domain/package.json packages/domain/
COPY packages/ai/package.json packages/ai/
COPY packages/agents/package.json packages/agents/
COPY apps/api/package.json apps/api/

RUN pnpm install --frozen-lockfile

COPY packages/ packages/
COPY apps/api/ apps/api/
COPY tsconfig.base.json ./

WORKDIR /app/apps/api
EXPOSE 4000
CMD ["pnpm", "start"]
