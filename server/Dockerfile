# HocusPocus 协作服务器（tsx 直跑 TypeScript）
FROM node:22-alpine

WORKDIR /app

COPY server/package.json server/package-lock.json ./
RUN npm ci

COPY server/ ./

EXPOSE 1234

# 健康检查走 HTTP /health；127.0.0.1 而非 localhost（busybox 会解析到 IPv6 ::1）
# 端口跟随 COLLAB_PORT（shell 形式运行时展开，alpine 自带 busybox wget）
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=6 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${COLLAB_PORT:-1234}/health" || exit 1

CMD ["npx", "tsx", "src/index.ts"]
