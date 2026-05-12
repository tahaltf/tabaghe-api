# به جای دانلود از اینترنت، از ایمیج موجود روی سرورت استفاده می‌کنیم
FROM tabagheh-backend:latest

WORKDIR /app

# فقط کدهای جدید رو کپی می‌کنیم (چون پکیج‌ها قبلاً نصب شدن)
COPY . .

# اجرای بیلد نهایی
RUN npx prisma generate && \
    npm run build

EXPOSE 3000
CMD ["node", "dist/src/main.js"]
