// 校验生产库表结构是否与本地 cloud.prisma 一致 (只读).
// 用法: npm run schema:check  (需要 .env 中的 REMOTE_DATABASE_URL)
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

// 加载 server/.env (tsx 不会自动加载)
const envFile = path.join(__dirname, "../.env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"#]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const remote = process.env.REMOTE_DATABASE_URL;
if (!remote) {
  console.error("请在 server/.env 中配置 REMOTE_DATABASE_URL (阿里云生产库连接串)");
  process.exit(1);
}

const schemaPath = path.join(__dirname, "../prisma/cloud.prisma");

console.log("正在从生产库拉取最新表结构 (只读)...");
const printed = execFileSync("npx", ["prisma", "db", "pull", "--print", "--schema", schemaPath], {
  env: { ...process.env, CLOUD_DATABASE_URL: remote },
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});

// 归一化: 去掉 generator/datasource 头部与空白差异, 只比较模型定义
function normalize(s: string): string[] {
  const body = s.slice(s.indexOf("model "));
  return body
    .split("\n")
    .map((l) => l.replace(/@ignore/g, "").replace(/\s+/g, " ").trim())
    .filter((l) => l && !l.startsWith("//"));
}

const local = normalize(fs.readFileSync(schemaPath, "utf8"));
const remoteLines = normalize(printed);

const localSet = new Set(local);
const remoteSet = new Set(remoteLines);
const onlyRemote = remoteLines.filter((l) => !localSet.has(l));
const onlyLocal = local.filter((l) => !remoteSet.has(l));

if (!onlyRemote.length && !onlyLocal.length) {
  console.log("✅ 表结构一致: 本地 cloud.prisma 与生产库无差异");
} else {
  console.log(`⚠️ 检测到差异 (生产库新增/变更 ${onlyRemote.length} 行, 本地多出 ${onlyLocal.length} 行):`);
  for (const l of onlyRemote.slice(0, 40)) console.log("  [生产] " + l);
  for (const l of onlyLocal.slice(0, 40)) console.log("  [本地] " + l);
  const tmp = path.join(os.tmpdir(), "cide-remote-schema.prisma");
  fs.writeFileSync(tmp, printed);
  console.log(`\n完整生产库结构已保存: ${tmp}`);
  console.log("如需更新本地: 用该文件内容替换 prisma/cloud.prisma 的模型部分, 然后 npm run replica:push");
  process.exit(2);
}
