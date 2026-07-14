// 本地副本 (cide_main_dev) 种子数据 — 真实生产表结构 + 测试数据.
// 安全保护: 仅允许对 localhost 执行, 绝不会写生产库.
import { PrismaClient } from "../src/generated/cloud";
import crypto from "crypto";

const url = process.env.CLOUD_DATABASE_URL ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("安全保护: seed-cloud 仅允许对 localhost 数据库执行. 当前 CLOUD_DATABASE_URL 不是本地地址.");
  process.exit(1);
}

const db = new PrismaClient({ datasources: { db: { url } } });
const md5 = (s: string) => crypto.createHash("md5").update(s, "utf8").digest("hex");

async function upsert(model: any, where: any, create: any) {
  const found = await model.findFirst({ where });
  if (!found) await model.create({ data: create });
}

async function main() {
  // ---- 字典 ----
  await upsert(db.t_a_stock_type, { stock_type: "01" }, { stock_type: "01", stock_type_name: "普通仓库" });
  for (const [stock, name] of [["01", "虫卵主库"], ["BZ-01", "包装物仓库"], ["XP-01", "虾片主库"]]) {
    await upsert(db.t_a_stock, { stock }, { stock, stock_type: "01", stock_name: name });
  }
  for (const [unit, name, no] of [["01", "袋", 1], ["02", "千克", 2], ["03", "桶", 3], ["11", "箱", 4], ["09", "个", 5]]) {
    await upsert(db.t_a_unit, { unit }, { unit: unit as string, unit_name: name as string, list_no: no as number });
  }
  const inTypes: Array<[string, string]> = [
    ["01", "毛料入库"], ["01_1", "虾片采购入库"], ["02", "产成品入库"], ["04", "生产原材料退料入库"],
    ["05", "包装物入库"], ["06", "盘盈入库"], ["07", "期初入库"], ["10", "其他入库"],
    ["11", "销售退货入库"], ["13", "生产入库"],
  ];
  for (const [c, n] of inTypes) await upsert(db.t_a_in_type, { in_type: c }, { in_type: c, in_type_name: n });
  const outTypes: Array<[string, string]> = [
    ["01", "生产出库"], ["02", "销售出库"], ["02_1", "虾片销售出库"], ["03", "盘亏出库"],
    ["07", "物料调拨出库"], ["08", "其他出库"], ["13", "毛料出库"], ["15", "半成品入库"],
  ];
  for (const [c, n] of outTypes) await upsert(db.t_a_out_type, { out_type: c }, { out_type: c, out_type_name: n });

  for (const [addr, no] of [["咸海", "XH"], ["HSK", "HSK"], ["TK", "TK"], ["斯库求克", "SKQK"]]) {
    await upsert(db.t_a_man_address, { man_address: addr }, {
      man_address: addr, man_address_name: addr, man_address_no: no, s_status: "有效",
    });
  }
  for (const p of ["编织袋", "纸箱"]) {
    await upsert(db.t_a_packing, { packing: p }, { packing: p, packing_name: p, s_status: "有效" });
  }
  await upsert(db.t_a_supplier_type, { supplier_type: "01" }, { supplier_type: "01", supplier_type_name: "常规供应商", s_status: "有效" });
  await upsert(db.t_a_cust_type, { cust_type: "01" }, { cust_type: "01", cust_type_name: "常规客户", s_status: "有效" });
  await upsert(db.t_a_material_type, { material_type: "毛料" }, { material_type: "毛料", material_type_name: "毛料", s_status: "有效" });
  await upsert(db.t_a_material_type, { material_type: "半成品" }, { material_type: "半成品", material_type_name: "半成品", s_status: "有效" });
  await upsert(db.t_a_material_type, { material_type: "成品" }, { material_type: "成品", material_type_name: "成品", s_status: "有效" });

  // ---- 组织/用户 ----
  await upsert(db.t_a_dept, { dept: "01" }, { dept: "01", dept_name: "仓储部", s_status: "有效" });
  await upsert(db.t_a_personnel, { personnel: "PN0010188" }, {
    personnel: "PN0010188", work_no: "0188", dept: "01", name: "张忠立",
    user_id: "ZHANGZHONGLI", user_pwd: md5("123456"), s_status: "有效", user_status: "有效",
  });

  // ---- 供应商 / 客户 ----
  for (const [code, name] of [["WXF", "王显峰"], ["MY", "牧怡"], ["MRL", "马如令"]]) {
    await upsert(db.t_a_supplier, { supplier: code }, { supplier: code, supplier_name: name, supplier_type: "01" });
  }
  await upsert(db.t_a_cust, { cust: "HNKH" }, { cust: "HNKH", cust_name: "海南客户A", cust_type: "01" });

  // ---- 物料 ----
  const materials: Array<[string, string, string, string]> = [
    ["WYL.WXF.001", "毛料", "毛料", "02"],
    ["WYL.WXF.003", "毛料", "毛料", "01"],
    ["WYL.MY.004", "毛料", "毛料", "01"],
    ["WYL.MRL.002", "毛料", "毛料", "01"],
    ["BCP.XP.001", "虾片半成品", "半成品", "02"],
    ["CP.XP.001", "虾片", "成品", "02"],
  ];
  for (const [id, name, type, unit] of materials) {
    await upsert(db.t_a_material, { material_id: id }, {
      material_id: id, material_no: id, material_name: name, material_type: type, unit, m_status: "有效",
    });
  }

  // ---- 采购入库单 (截图数据) ----
  const docs = [
    { no: "CGRK0002001279", date: "2026-07-01", sup: "WXF", car: "25-14", mat: "WYL.WXF.001", code: "WXF.XH.25.14", addr: "咸海", qty: 20000, unit: "02", audited: true },
    { no: "CGRK0002001281", date: "2026-05-08", sup: "MY", car: "25-10", mat: "WYL.MY.004", code: "MY.HSK.25.10", addr: "HSK", qty: 2056, unit: "01", audited: true },
    { no: "CGRK0002001280", date: "2026-04-14", sup: "WXF", car: "25-08", mat: "WYL.WXF.003", code: "WXF.TK.25.08", addr: "TK", qty: 1000, unit: "01", audited: true },
    { no: "CGRK0002001277", date: "2026-04-09", sup: "WXF", car: "25-7", mat: "WYL.WXF.001", code: "WXF.XH.25.7", addr: "咸海", qty: 10000, unit: "02", audited: true },
    { no: "CGRK0002001276", date: "2026-02-06", sup: "MRL", car: "25-06", mat: "WYL.MRL.002", code: "MRL.SKQK.25.06", addr: "斯库求克", qty: 501, unit: "01", audited: false },
    { no: "CGRK0002001275", date: "2026-01-14", sup: "WXF", car: "25-05", mat: "WYL.WXF.001", code: "WXF.XH.25.05", addr: "咸海", qty: 20080, unit: "02", audited: false },
  ];
  let seq = 1;
  for (const d of docs) {
    const exists = await db.t_stock_in.findUnique({ where: { in_id: d.no } });
    if (exists) continue;
    await db.t_stock_in.create({
      data: {
        in_id: d.no, stock: "01", in_person: "PN0010188", entry_person: "PN0010188",
        in_type: "01", date_time: new Date(d.date), car_no2: d.car,
        s_status: d.audited ? "已审核" : "未审核",
        audit_person: d.audited ? "PN0010188" : null,
        audit_time: d.audited ? new Date(d.date) : null,
      },
    });
    await db.t_stock_in_detail.create({
      data: {
        in_detail: `RKD${String(seq++).padStart(13, "0")}`, in_id: d.no,
        material_id: d.mat, material_no: d.mat, material_name: "毛料",
        unit: d.unit, quantity: d.qty, s_status: d.audited ? "已审核" : "未审核",
        s_code: d.code, man_address: d.addr, packing: "编织袋", supplier: d.sup, batch_no: d.car,
      },
    });
    if (d.audited) {
      // 模拟桌面端审核后的库存维护
      await db.t_material_batch.create({
        data: {
          material_batch_id: `MB${d.no}`, material_id: d.mat, batch_no: d.car,
          in_quantity: d.qty, out_quantity: 0, left_quantity: d.qty,
          s_code: d.code, man_address: d.addr, supplier: d.sup, stock: "01",
        },
      });
      const sm = await db.t_stock_material.findFirst({ where: { stock: "01", material_id: d.mat } });
      if (sm) {
        await db.t_stock_material.updateMany({
          where: { stock: "01", material_id: d.mat },
          data: { quantity: Number(sm.quantity) + d.qty, time_quantity: Number(sm.time_quantity) + d.qty, date_time: new Date() },
        });
      } else {
        await db.t_stock_material.create({
          data: { stock: "01", material_id: d.mat, quantity: d.qty, time_quantity: d.qty, date_time: new Date() },
        });
      }
    }
  }

  console.log("本地副本种子完成. 登录: ZHANGZHONGLI / 123456");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
