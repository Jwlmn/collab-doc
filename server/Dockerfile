# HocusPocus 协作服务器（tsx 直跑 TypeScript）
FROM node:22-alpine

WORKDIR /app

COPY server/package.json server/package-lock.json ./
RUN npm ci

COPY server/ ./

EXPOSE 1234

CMD ["npx", "tsx", "src/index.ts"]
