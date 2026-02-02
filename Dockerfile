FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

ARG DATABASE_URL="postgresql://temp:temp@localhost:5432/temp"
ENV DATABASE_URL=$DATABASE_URL

RUN npx prisma generate
RUN npm run build

# اضافه کردن این دستور برای اینکه بفهمیم فایل‌ها کجا ساخته شدن (توی لاگ بیلد نشون میده)
RUN ls -R dist

EXPOSE 3000
# تغییر موقت استارت آپ برای پیدا کردن فایل اصلی
CMD ["node", "dist/src/main.js"]
