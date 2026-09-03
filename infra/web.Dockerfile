FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY apps/web/package.json ./
RUN pnpm install --frozen-lockfile
COPY apps/web/ .
RUN pnpm build

FROM node:22-alpine
RUN npm i -g serve
WORKDIR /app
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["serve", "-s", "dist", "-l", "3000", "--", "-c", "{\"headers\":[{\"source\":\"**\",\"headers\":[{\"key\":\"X-Frame-Options\",\"value\":\"DENY\"}]}]}"]
