# ---- Build stage ----
FROM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN corepack use pnpm@$(node -p "require('./package.json').packageManager.split('@')[1].split('+')[0]") \
  && pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

# ---- Production stage ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable \
  && addgroup -S app && adduser -S app -G app

COPY package.json pnpm-lock.yaml ./
RUN corepack use pnpm@$(node -p "require('./package.json').packageManager.split('@')[1].split('+')[0]") \
  && pnpm install --frozen-lockfile --prod

COPY --from=builder /app/dist ./dist

USER app
EXPOSE 5000

CMD ["node", "dist/index.cjs"]
