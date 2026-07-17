#!/usr/bin/env bash
# 生产启动：安装依赖 -> 生成 Prisma 客户端 -> 打包前端 -> 起服务(单端口托管 web/dist + API)
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f server/.env ]; then
  echo "[ERROR] 缺少 server/.env（至少需 CLOUD_DATABASE_URL / JWT_SECRET / PORT / READ_ONLY），参考 README.md" >&2
  exit 1
fi

echo "== [1/4] 安装依赖 =="
npm install
echo "== [2/4] 生成 Prisma 生产库客户端(按本机平台) =="
npm run cloud:generate -w server
echo "== [3/4] 打包前端(vite build -> web/dist) =="
npm run build -w web
echo "== [4/4] 启动服务(托管 web/dist + API，默认端口 3001) =="
npm run serve -w server
