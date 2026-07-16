# 慈德ERP — 阿里云函数计算 FC3.0 Web 函数（自定义容器）镜像
# 单进程：Express 同时提供 /api 接口并托管 web/dist 前端。
# 关键：在 Linux 内构建 → Prisma 自动安装 Linux 版查询引擎，避免 Mac 引擎打包上云报错。

FROM node:22-slim

# Prisma 运行时依赖 openssl；ca-certificates 供 TLS 连接使用
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1) 先只拷贝各 workspace 的清单，利用 Docker 缓存
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json

# 2) 安装全部依赖（含构建所需的 devDependencies）
RUN npm ci

# 3) 拷贝源码（.dockerignore 已排除 node_modules / dist / .env 等）
COPY . .

# 4) 生成两套 Prisma 客户端（此时在 Linux 内，引擎会自动匹配）
#    - schema.prisma  → 默认客户端（node_modules/@prisma/client），index.ts 顶部会 import 到
#    - cloud.prisma   → 生产结构客户端（server/src/generated/cloud），cloud 模式实际使用
RUN npx prisma generate --schema server/prisma/schema.prisma \
    && npx prisma generate --schema server/prisma/cloud.prisma

# 5) 构建：server（tsc → server/dist） + web（vite → web/dist）
RUN npm run build

# 6) tsc 不会把 JS 形态的 generated 客户端拷进 dist，这里手动补齐
#    使 server/dist/cloud/prisma.js 里的 require("../generated/cloud") 能解析到
RUN cp -r server/src/generated server/dist/generated

# 7) 去掉构建期依赖，保留运行期的 @prisma/client 与 Linux 引擎
RUN npm prune --omit=dev

ENV NODE_ENV=production
# FC 自定义容器的监听端口（与 s.yaml customContainerConfig.port 一致）
ENV PORT=9000
EXPOSE 9000

CMD ["node", "server/dist/index.js"]
