# -----------------------------------------------------------------------------
# Stage 1: Build NestJS Application
# -----------------------------------------------------------------------------
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
# Avoid accidental binary downloads from test-only packages if reintroduced
ENV REDISMS_DISABLE_POSTINSTALL=1
RUN --mount=type=cache,target=/root/.npm \
    npm ci --legacy-peer-deps

COPY . .

# اجرای بیلد نهایی و ساخت کلاینت پریسما
ARG DATABASE_URL="postgresql://temp:temp@localhost:5432/temp"
ENV NODE_ENV=production

RUN DATABASE_URL=$DATABASE_URL npx prisma generate && \
    npm run build && \
    mkdir -p dist/prisma/seed-data && \
    cp prisma/seed-data/*.json dist/prisma/seed-data/

# -----------------------------------------------------------------------------
# Stage 2: Chromium runtime — prebuilt by deploy (Dockerfile.base → tabagheh-api-base)
# Do NOT use --cache-from on this image; BuildKit needs a real FROM, not a cache manifest.
# Local first-time build:
#   docker build -f Dockerfile.base -t tabagheh-api-base:latest .
# -----------------------------------------------------------------------------
FROM tabagheh-api-base:latest AS api-base

# -----------------------------------------------------------------------------
# Stage 3: Production
# -----------------------------------------------------------------------------
FROM api-base AS production

ENV NODE_ENV=production

COPY package*.json ./
# 🟢 حالا این دستور بدون تلاش برای دانلود کروم و بدون خطا اجرا می‌شود
RUN --mount=type=cache,target=/root/.npm \
    npm ci --only=production --legacy-peer-deps

# کپی کردن خروجی‌های اصلی از استیج بیلد
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/assets ./assets
# تایید ساختار فایل‌ها جهت اطمینان در لاگ
RUN ls -R dist

EXPOSE 3000
CMD ["node", "dist/src/main.js"]
