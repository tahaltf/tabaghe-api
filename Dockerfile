# به جای دانلود از اینترنت، از ایمیج موجود روی سرورت استفاده می‌کنیم
FROM tabagheh-backend:latest

# Chromium برای تولید PDF گواهی کارشناسی (Puppeteer)
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-core \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app

# فقط کدهای جدید رو کپی می‌کنیم (چون پکیج‌ها قبلاً نصب شدن)
COPY . .

# اجرای بیلد نهایی
ARG DATABASE_URL="postgresql://temp:temp@localhost:5432/temp"
ENV NODE_ENV=production

# prisma generate = ساخت @prisma/client از schema (جدا از migrate deploy که فقط SQL اجرا می‌کند).
RUN DATABASE_URL=$DATABASE_URL npx prisma generate && \
    npm run build
# اضافه کردن این دستور برای اینکه بفهمیم فایل‌ها کجا ساخته شدن (توی لاگ بیلد نشون میده)
RUN ls -R dist

EXPOSE 3000
CMD ["node", "dist/src/main.js"]
