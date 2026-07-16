export interface DatabaseIdentity {
  isLocal: boolean;
  label: string;
}

export function describeSqlServerDatabase(connectionString: string | undefined): DatabaseIdentity {
  if (!connectionString) return { isLocal: false, label: "UNKNOWN" };
  // Prisma SQL Server 使用 `sqlserver://host:port;database=...`，它不是标准 URL，
  // 因此分别解析 authority 和分号参数，且绝不向调用方返回凭据。
  const authorityMatch = connectionString.match(/^sqlserver:\/\/([^;/?#]+)/i);
  const databaseMatch = connectionString.match(/(?:^|;)database=([^;]+)/i);
  if (!authorityMatch) return { isLocal: false, label: databaseMatch?.[1].trim() || "UNKNOWN" };
  const hostPort = authorityMatch[1].split("@").pop()!.toLowerCase();
  const hostname = hostPort.startsWith("[")
    ? hostPort.slice(0, hostPort.indexOf("]") + 1)
    : hostPort.split(":")[0];
  const isLocal = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  return {
    isLocal,
    label: isLocal ? "LOCAL" : databaseMatch?.[1].trim() || hostname || "REMOTE",
  };
}
