import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // 用户
  const passwordHash = await bcrypt.hash("123456", 10);
  const admin = await prisma.user.upsert({
    where: { username: "ZHANGZHONGLI" },
    update: {},
    create: {
      username: "ZHANGZHONGLI",
      passwordHash,
      displayName: "张忠立",
      roles: "ADMIN,WAREHOUSE",
    },
  });

  // 仓库
  const wh = await prisma.warehouse.upsert({
    where: { code: "CKZK" },
    update: {},
    create: { code: "CKZK", name: "虫卵主库" },
  });

  // 供应商
  const suppliers: Record<string, number> = {};
  for (const name of ["王昱峰", "牧怡", "马如令"]) {
    const s = await prisma.supplier.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    suppliers[name] = s.id;
  }

  // 客户
  await prisma.customer.upsert({
    where: { name: "海南客户A" },
    update: {},
    create: { name: "海南客户A" },
  });

  // 物料
  const materials: Record<string, number> = {};
  const materialDefs = [
    { code: "WYL.WXF.001", name: "毛料", category: "RAW", unit: "千克", packaging: "编织袋" },
    { code: "WYL.WXF.003", name: "毛料", category: "RAW", unit: "袋", packaging: "编织袋" },
    { code: "WYL.MY.004", name: "毛料", category: "RAW", unit: "袋", packaging: "编织袋" },
    { code: "WYL.MRL.002", name: "毛料", category: "RAW", unit: "袋", packaging: "编织袋" },
    { code: "BCP.XP.001", name: "虾片半成品", category: "SEMI", unit: "千克", packaging: "编织袋" },
    { code: "CP.XP.001", name: "虾片", category: "FINISHED", unit: "千克", packaging: "纸箱" },
  ];
  for (const m of materialDefs) {
    const rec = await prisma.material.upsert({
      where: { code: m.code },
      update: {},
      create: m,
    });
    materials[m.code] = rec.id;
  }

  // 采购入库单 (来自截图数据)
  const docs = [
    { docNo: "CGRK0002001279", date: "2026-07-01", supplier: "王昱峰", vehicleNo: "25-14", code: "WYL.WXF.001", retrieval: "WXF.XH.25.14", origin: "咸海", qty: 20000, unit: "千克" },
    { docNo: "CGRK0002001281", date: "2026-05-08", supplier: "牧怡", vehicleNo: "25-10", code: "WYL.MY.004", retrieval: "MY.HSK.25.10", origin: "HSK", qty: 2056, unit: "袋" },
    { docNo: "CGRK0002001280", date: "2026-04-14", supplier: "王昱峰", vehicleNo: "25-08", code: "WYL.WXF.003", retrieval: "WXF.TK.25.08", origin: "TK", qty: 1000, unit: "袋" },
    { docNo: "CGRK0002001277", date: "2026-04-09", supplier: "王昱峰", vehicleNo: "25-7", code: "WYL.WXF.001", retrieval: "WXF.XH.25.7", origin: "咸海", qty: 10000, unit: "千克" },
    { docNo: "CGRK0002001276", date: "2026-02-06", supplier: "马如令", vehicleNo: "25-06", code: "WYL.MRL.002", retrieval: "MRL.SKQK.25.06", origin: "斯库求克", qty: 501, unit: "袋" },
    { docNo: "CGRK0002001275", date: "2026-01-14", supplier: "王昱峰", vehicleNo: "25-05", code: "WYL.WXF.001", retrieval: "WXF.XH.25.05", origin: "咸海", qty: 20080, unit: "千克" },
    { docNo: "CGRK0002001274", date: "2026-01-11", supplier: "王昱峰", vehicleNo: "25-04", code: "WYL.WXF.001", retrieval: "WXF.XH.25.04", origin: "咸海", qty: 19920, unit: "千克" },
    { docNo: "CGRK0002001272", date: "2025-09-23", supplier: "王昱峰", vehicleNo: "25-03", code: "WYL.WXF.001", retrieval: "WXF.XH.25.03", origin: "咸海", qty: 20000, unit: "千克" },
    { docNo: "CGRK0002001271", date: "2025-08-23", supplier: "王昱峰", vehicleNo: "25-01", code: "WYL.WXF.001", retrieval: "WXF.XH.25.01", origin: "咸海", qty: 23200, unit: "千克" },
    { docNo: "CGRK0002001270", date: "2025-08-15", supplier: "王昱峰", vehicleNo: "25-01", code: "WYL.WXF.001", retrieval: "WXF.XH.25.01", origin: "咸海", qty: 16800, unit: "千克" },
  ];

  for (const d of docs) {
    const exists = await prisma.document.findUnique({ where: { docNo: d.docNo } });
    if (exists) continue;
    await prisma.document.create({
      data: {
        docNo: d.docNo,
        docType: "PURCHASE_IN",
        date: new Date(d.date),
        status: "APPROVED",
        warehouseId: wh.id,
        supplierId: suppliers[d.supplier],
        vehicleNo: d.vehicleNo,
        createdById: admin.id,
        approvedById: admin.id,
        approvedAt: new Date(d.date),
        lines: {
          create: [
            {
              materialId: materials[d.code],
              batchNo: d.vehicleNo,
              retrievalCode: d.retrieval,
              origin: d.origin,
              quantity: d.qty,
              unit: d.unit,
              packaging: "编织袋",
            },
          ],
        },
      },
    });
  }

  // 单据编号计数器
  const counters: Array<[string, number]> = [
    ["PURCHASE_IN", 2001281],
    ["PRODUCTION_IN", 1000000],
    ["OTHER_IN", 1000000],
    ["MATERIAL_OUT", 1000000],
    ["PRODUCTION_OUT", 1000000],
    ["SALES_OUT", 1000000],
    ["OTHER_OUT", 1000000],
    ["GAIN", 1000000],
    ["LOSS", 1000000],
  ];
  for (const [docType, seq] of counters) {
    await prisma.docCounter.upsert({
      where: { docType },
      update: {},
      create: { docType, seq },
    });
  }

  console.log("Seed complete. 登录: ZHANGZHONGLI / 123456");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
