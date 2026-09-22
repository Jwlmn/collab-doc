# Web：构建前端 + Nginx（静态托管 / Laravel fastcgi / 协作 WebSocket 反代）

# ---- 阶段1：构建前端 ----
FROM node:22-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- 阶段2：Nginx ----
FROM nginx:1.27-alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
# 静态产物与 Laravel public 同一 root（fastcgi SCRIPT_FILENAME 路径需与 app 容器一致）
COPY --from=build /app/dist/ /var/www/html/public/
