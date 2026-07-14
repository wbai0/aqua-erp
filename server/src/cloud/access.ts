import type { NextFunction, Request, Response } from "express";

export function isLocalReplica(): boolean {
  const connectionString = process.env.CLOUD_DATABASE_URL;
  if (!connectionString) return false;
  // Prisma SQL Server 使用 `sqlserver://host:port;database=...`，它不是标准 URL，
  // 因此只解析第一个分号前的 authority，不能用字符串 contains 判断。
  const match = connectionString.match(/^sqlserver:\/\/([^;/?#]+)/i);
  if (!match) return false;
  const hostPort = match[1].split("@").pop()!.toLowerCase();
  const hostname = hostPort.startsWith("[")
    ? hostPort.slice(0, hostPort.indexOf("]") + 1)
    : hostPort.split(":")[0];
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * cloud 模式统一写入保护。
 * 登录接口不经过此中间件；其余业务 API 只有连接本地副本时才允许非只读请求。
 */
export function requireLocalReplicaWrite(req: Request, res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method) || isLocalReplica()) return next();
  return res.status(403).json({ error: "远端数据库为只读 — 请切换到本地副本后再执行写入操作" });
}
