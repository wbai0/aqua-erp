// 生成本地副本用 schema: 从 cloud.prisma 中剔除无有效列的历史临时表
// (如 Sheet_temp — 全中文列名被 Prisma 注释掉, 无法建表, 且与应用无关).
import fs from "fs";
import path from "path";

const src = path.join(__dirname, "../prisma/cloud.prisma");
const dst = path.join(__dirname, "../prisma/cloud.replica.prisma");

const content = fs.readFileSync(src, "utf8");
const headerEnd = content.indexOf("model ");
const header = content.slice(0, headerEnd);
const body = content.slice(headerEnd);

const blocks = body.split(/\n(?=model )/);
const kept: string[] = [];
const dropped: string[] = [];

for (const block of blocks) {
  const nameMatch = block.match(/^model (\S+)/);
  const name = nameMatch?.[1] ?? "?";
  // 有效列: 非注释、非空、非 @@ 行、非纯关系行的字段行
  const hasActiveColumn = block
    .split("\n")
    .slice(1)
    .some((l) => {
      const t = l.trim();
      return t && !t.startsWith("//") && !t.startsWith("///") && !t.startsWith("@@") && !t.startsWith("}") && /^\w+\s+/.test(t);
    });
  if (hasActiveColumn) kept.push(block);
  else dropped.push(name);
}

fs.writeFileSync(dst, header + kept.join("\n"));
console.log(`副本 schema 已生成: ${kept.length} 张表保留, 剔除无有效列的表: ${dropped.join(", ") || "无"}`);
