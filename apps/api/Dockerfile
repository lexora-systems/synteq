# syntax=docker/dockerfile:1
FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY apps/api/package.json ./apps/api/package.json
RUN npm install --ignore-scripts

FROM deps AS build
COPY . .
RUN npm run build --workspace @synteq/shared && npm run prisma:generate --workspace api && npm run build --workspace api

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./node_modules/@synteq/shared/dist
COPY --from=build /app/packages/shared/package.json ./node_modules/@synteq/shared/package.json
EXPOSE 8080
CMD ["node", "apps/api/dist/src/server.js"]


