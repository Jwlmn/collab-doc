# Laravel 后端（php-fpm，代码路径 /var/www/html）
FROM php:8.5-fpm

RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq-dev libonig-dev libzip-dev libicu-dev unzip git \
    && docker-php-ext-install pdo_pgsql mbstring zip sockets bcmath intl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /var/www/html

# Composer（官方 php 镜像不自带）
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

# 依赖层缓存
COPY backend/composer.json backend/composer.lock ./
RUN composer install --no-dev --no-interaction --no-progress --prefer-dist --no-scripts

COPY backend/ .

# 清除宿主机带入的 dev 缓存（package discovery/config 等），
# 否则 --no-dev 镜像会按 dev 缓存加载不存在的类（如 laravel/boost）
RUN rm -rf bootstrap/cache/*.php \
    && chown -R www-data:www-data storage bootstrap/cache \
    && chmod -R ug+rwx storage bootstrap/cache

EXPOSE 9000

# 启动前执行迁移（单副本场景）
CMD ["sh", "-c", "php artisan migrate --force && php-fpm -F"]
