import { PrismaClient } from "../generated/cloud";

// 真实表结构客户端。所有查询和写入统一使用 CLOUD_DATABASE_URL。
export const cloudPrisma = new PrismaClient({
  datasources: { db: { url: process.env.CLOUD_DATABASE_URL } },
});
