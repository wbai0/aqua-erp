// 把生产库 (REMOTE_DATABASE_URL, 只读) 的数据完整搬移到本地副本 (CLOUD_DATABASE_URL).
// - 仅对生产库执行 SELECT; 所有写操作只发生在本地 (强制 localhost 校验)
// - 复制前禁用本地全部外键约束, 清空数据, 复制后恢复约束 (不回验历史行)
// - 跳过日志/临时表 (可用 SYNC_ALL=1 强制全部)
// 用法: npm run replica:sync -w server
import { PrismaClient, Prisma } from "../src/generated/cloud";
import fs from "fs";
import path from "path";

// 加载 server/.env
const envFile = path.join(__dirname, "../.env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"#]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const localUrl = process.env.CLOUD_DATABASE_URL ?? "";
const remoteUrl = process.env.REMOTE_DATABASE_URL ?? "";
if (!/localhost|127\.0\.0\.1/.test(localUrl)) {
  console.error("安全保护: CLOUD_DATABASE_URL 必须指向 localhost 本地副本");
  process.exit(1);
}
if (!remoteUrl) {
  console.error("请在 server/.env 配置 REMOTE_DATABASE_URL");
  process.exit(1);
}

const local = new PrismaClient({ datasources: { db: { url: localUrl } } });
const remote = new PrismaClient({ datasources: { db: { url: remoteUrl } } });

const SKIP = [
  "itemp", "T1", "t_a_temp", "t_a_accept_temp", "t_a_material_price_temp",
  "t_s_log_dataview", "t_s_log_exception", "t_s_log_funtion", "t_s_log_login", "t_s_log_page",
  "t_s_syn_log", "t_e_system_log", "t_e_user_log", "Sheet_temp", "应收账款",
];
const MAX_ROWS = Number(process.env.SYNC_MAX_ROWS ?? 200000);

const ident = (name: string) => Prisma.raw(`[${name.replace(/\]/g, "]]")}]`);

function toParam(v: any): any {
  if (v === null || v === undefined) return null;
  // Prisma Decimal → 字符串 (避免浮点精度损失)
  if (typeof v === "object" && typeof (v as any).toNumber === "function" && !(v instanceof Date)) return String(v);
  return v;
}

async function main() {
  const t0 = Date.now();
  console.log("目标(写): 本地副本  来源(读): 生产库\n");

  // 本地管理的表 + 各表列信息
  const tables: string[] = (
    await local.$queryRaw<any[]>(Prisma.sql`SELECT name FROM sys.tables ORDER BY name`)
  ).map((r) => r.name).filter((t) => process.env.SYNC_ALL === "1" || !SKIP.includes(t));

  const colInfo = await local.$queryRaw<any[]>(Prisma.sql`
    SELECT t.name AS tbl, c.name AS col, c.is_identity, c.is_computed, c.max_length, c.precision, c.scale, ty.name AS type
    FROM sys.tables t
    JOIN sys.columns c ON c.object_id = t.object_id
    JOIN sys.types ty ON ty.user_type_id = c.user_type_id
    ORDER BY t.name, c.column_id`);

  // 每列的 CAST 目标类型 — 避免多行 VALUES 中 NULL 参数类型推断冲突
  function typeExpr(r: any): string {
    const t = String(r.type);
    switch (t) {
      case "varchar": case "char": case "varbinary": case "binary":
        return `${t}(${r.max_length === -1 ? "max" : r.max_length})`;
      case "nvarchar": case "nchar":
        return `${t}(${r.max_length === -1 ? "max" : r.max_length / 2})`;
      case "decimal": case "numeric":
        return `${t}(${r.precision},${r.scale})`;
      case "text": return "varchar(max)";
      case "ntext": return "nvarchar(max)";
      case "image": return "varbinary(max)";
      default: return t; // int/bigint/bit/datetime/date/money/float/uniqueidentifier...
    }
  }
  const colsByTable = new Map<string, { col: string; cast: string }[]>();
  for (const r of colInfo) {
    if (r.is_identity || r.is_computed || r.type === "timestamp" || r.type === "rowversion") continue;
    if (!colsByTable.has(r.tbl)) colsByTable.set(r.tbl, []);
    colsByTable.get(r.tbl)!.push({ col: r.col, cast: typeExpr(r) });
  }

  // 1. 禁用本地全部外键
  console.log("禁用本地外键约束...");
  for (const t of tables) {
    await local.$executeRaw(Prisma.sql`ALTER TABLE ${ident(t)} NOCHECK CONSTRAINT ALL`);
  }

  // 2. 清空本地数据
  console.log("清空本地数据...");
  for (const t of tables) {
    await local.$executeRaw(Prisma.sql`DELETE FROM ${ident(t)}`);
  }

  // 3. 逐表复制
  let totalRows = 0;
  const skippedBig: string[] = [];
  const failed: string[] = [];
  for (const t of tables) {
    const cols = colsByTable.get(t) ?? [];
    if (!cols.length) continue;
    let cnt = 0;
    try {
      const c = await remote.$queryRaw<any[]>(
        Prisma.sql`SELECT COUNT(*) AS c FROM ${ident(t)}`
      );
      cnt = Number(c[0]?.c ?? 0);
    } catch (e: any) {
      console.log(`  ${t}: 远端读取失败, 跳过 (${String(e.message).split("\n")[0].slice(0, 80)})`);
      continue;
    }
    if (cnt === 0) continue;
    if (cnt > MAX_ROWS) {
      skippedBig.push(`${t} (${cnt} 行)`);
      continue;
    }

    try {
      const colList = Prisma.raw(cols.map((c) => `[${c.col}]`).join(", "));
      const rows = await remote.$queryRaw<any[]>(
        Prisma.sql`SELECT ${colList} FROM ${ident(t)}`
      );

      // SQL Server 单语句最多 ~2100 个参数
      const chunkSize = Math.max(1, Math.floor(2000 / cols.length));
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const tuples = chunk.map(
          (r) =>
            Prisma.sql`(${Prisma.join(
              cols.map((c) => {
                const v = toParam(r[c.col]);
                return v === null ? Prisma.sql`NULL` : Prisma.sql`CAST(${v} AS ${Prisma.raw(c.cast)})`;
              })
            )})`
        );
        await local.$executeRaw(
          Prisma.sql`INSERT INTO ${ident(t)} (${colList}) VALUES ${Prisma.join(tuples)}`
        );
      }
      totalRows += rows.length;
      console.log(`  ${t}: ${rows.length} 行`);
    } catch (e: any) {
      failed.push(t);
      console.log(`  ❌ ${t}: ${String(e?.meta?.message ?? e.message).split("\n")[0].slice(0, 120)}`);
    }
  }

  // 4. 恢复外键 (不回验历史数据)
  console.log("恢复外键约束...");
  for (const t of tables) {
    await local.$executeRaw(Prisma.sql`ALTER TABLE ${ident(t)} CHECK CONSTRAINT ALL`);
  }

  console.log(`\n✅ 完成: ${totalRows} 行, 耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (skippedBig.length) console.log(`⚠️ 超过 ${MAX_ROWS} 行被跳过的表: ${skippedBig.join("; ")} (SYNC_MAX_ROWS 可调)`);
  if (failed.length) console.log(`❌ 失败的表 (${failed.length}): ${failed.join(", ")}`);
  console.log("注意: 登录用户现在来自生产库 — 请使用与桌面端相同的用户名密码.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await local.$disconnect(); await remote.$disconnect(); });
