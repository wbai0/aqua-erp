import { PrismaClient } from "../generated/cloud";

// 真实表结构客户端。连接本地副本时可写，连接远端数据库时由入口中间件强制只读。
export const cloudPrisma = new PrismaClient({
  datasources: { db: { url: process.env.CLOUD_DATABASE_URL } },
});
