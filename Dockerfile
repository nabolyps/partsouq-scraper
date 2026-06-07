# نستخدم صورة Puppeteer الرسمية لأنها فيها Chrome + كل المكتبات جاهزة
# (هاد بيحل مشكلة تشغيل المتصفح على Railway)
FROM ghcr.io/puppeteer/puppeteer:22.12.1

# مسار الكروم الجاهز جوّا الصورة
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
ENV NODE_ENV=production

WORKDIR /app

# نسخ ملفات الباكج أول شي للاستفادة من الكاش
COPY package*.json ./
RUN npm install --omit=dev

# نسخ باقي الكود
COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
