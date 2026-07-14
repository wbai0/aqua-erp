// 单据写操作 — 仅在连接本地副本 (localhost) 时启用.
// 生产库的审核逻辑在桌面端程序内 (见根目录 README), 此处的库存维护
// (t_stock_material / t_material_batch) 为副本内的模拟实现, 用于开发与演示.
// 注: 副本是 SQL Server 2022, 可放心使用 Prisma 类型化查询 (OFFSET 限制仅存在于生产老版本).
import { Router } from "express";
import { Prisma } from "../generated/cloud";
import { cloudPrisma as db } from "./prisma";

const S = Prisma.sql;

// ---------- 单据编号: 参照生产格式 前缀+数字 (如 CGRK0002001279 / SCRK000000013133) ----------
const IN_PREFIX: Record<string, string> = {
  "01": "CGRK", "01_1": "XPRK", "02": "CCRK", "05": "BZRK", "06": "PYRK", "07": "QCRK", "13": "SCRK",
};
const OUT_PREFIX: Record<string, string> = {
  "01": "SCCK", "02": "XSCK", "02_1": "XPCK", "03": "PKCK", "13": "MLCK",
};

async function nextDocId(kind: "in" | "out", typeCode: string): Promise<string> {
  const prefix = (kind === "in" ? IN_PREFIX[typeCode] : OUT_PREFIX[typeCode]) ?? (kind === "in" ? "QTRK" : "QTCK");
  const col = kind === "in" ? S`in_id` : S`out_id`;
  const table = kind === "in" ? S`t_stock_in` : S`t_stock_out`;
  const rows = await db.$queryRaw<any[]>(
    S`SELECT MAX(${col}) AS m FROM ${table} WHERE ${col} LIKE ${prefix + "%"}`
  );
  const max: string | null = rows[0]?.m ?? null;
  let width = 12;
  let n = 1;
  if (max) {
    const tail = max.slice(prefix.length);
    if (/^\d+$/.test(tail)) {
      width = tail.length;
      n = parseInt(tail, 10) + 1;
    }
  }
  return prefix + String(n).padStart(width, "0");
}

interface LineIn {
  materialId: string;
  quantity: number;
  unit: string; // 单位编码 (t_a_unit.unit)
  retrievalCode?: string | null;
  origin?: string | null;
  packaging?: string | null;
  batchNo?: string | null;
  note?: string | null;
}

function parseBody(body: any): {
  kind: "in" | "out"; typeCode: string; date: Date; warehouseId: string;
  supplierId?: string | null; customerId?: string | null; vehicleNo?: string | null;
  remark?: string | null; lines: LineIn[];
} | string {
  const docType = String(body?.docType ?? "");
  const kind = docType.startsWith("IN_") ? "in" : docType.startsWith("OUT_") ? "out" : null;
  if (!kind) return "无效的单据类型";
  const typeCode = docType.slice(kind === "in" ? 3 : 4);
  if (!body.warehouseId) return "请选择仓库";
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!lines.length) return "至少需要一行明细";
  for (const l of lines) {
    if (!l.materialId) return "明细行缺少物料";
    if (!(Number(l.quantity) > 0)) return "数量必须大于 0";
    if (!l.unit) return "明细行缺少单位";
  }
  return {
    kind, typeCode,
    date: new Date(body.date ?? Date.now()),
    warehouseId: String(body.warehouseId),
    supplierId: body.supplierId ? String(body.supplierId) : null,
    customerId: body.customerId ? String(body.customerId) : null,
    vehicleNo: body.vehicleNo ? String(body.vehicleNo) : null,
    remark: body.remark ? String(body.remark) : null,
    lines: lines.map((l: any) => ({
      materialId: String(l.materialId),
      quantity: Number(l.quantity),
      unit: String(l.unit),
      retrievalCode: l.retrievalCode || null,
      origin: l.origin || null,
      packaging: l.packaging || null,
      batchNo: l.batchNo || body.vehicleNo || null,
      note: l.note || null,
    })),
  };
}

async function findDoc(id: string) {
  const inDoc = await db.t_stock_in.findUnique({ where: { in_id: id }, include: { t_stock_in_detail: true } });
  if (inDoc) return { kind: "in" as const, doc: inDoc, details: inDoc.t_stock_in_detail };
  const outDoc = await db.t_stock_out.findUnique({ where: { out_id: id }, include: { t_stock_out_detail: true } });
  if (outDoc) return { kind: "out" as const, doc: outDoc, details: outDoc.t_stock_out_detail };
  return null;
}

export function registerWriteRoutes(router: Router) {
  // 新单 (未审核)
  router.post("/", async (req, res) => {
    const p = parseBody(req.body);
    if (typeof p === "string") return res.status(400).json({ error: p });
    const person = req.user?.personnelId ?? "PN0010188";
    const docId = await nextDocId(p.kind, p.typeCode);

    await db.$transaction(async (tx) => {
      if (p.kind === "in") {
        await tx.t_stock_in.create({
          data: {
            in_id: docId, stock: p.warehouseId, in_person: person, entry_person: person,
            in_type: p.typeCode, date_time: p.date, car_no2: p.vehicleNo, memo: p.remark,
            in_cust: p.customerId, s_status: "未审核",
          },
        });
        let i = 0;
        for (const l of p.lines) {
          const mat = await tx.t_a_material.findUnique({ where: { material_id: l.materialId } });
          await tx.t_stock_in_detail.create({
            data: {
              in_detail: `${docId}D${String(++i).padStart(2, "0")}`, in_id: docId,
              material_id: l.materialId, material_no: mat?.material_no, material_name: mat?.material_name,
              unit: l.unit, quantity: l.quantity, s_status: "未审核",
              s_code: l.retrievalCode, man_address: l.origin, packing: l.packaging,
              batch_no: l.batchNo, supplier: p.supplierId, memo: l.note,
            },
          });
        }
      } else {
        await tx.t_stock_out.create({
          data: {
            out_id: docId, stock: p.warehouseId, out_person: person, entry_person: person,
            out_type: p.typeCode, date_time: p.date, car_no: p.vehicleNo, memo: p.remark,
            cust: p.customerId, s_status: "未审核",
          },
        });
        let i = 0;
        for (const l of p.lines) {
          const mat = await tx.t_a_material.findUnique({ where: { material_id: l.materialId } });
          await tx.t_stock_out_detail.create({
            data: {
              out_detail: `${docId}D${String(++i).padStart(2, "0")}`, out_id: docId,
              material_id: l.materialId, material_no: mat?.material_no, material_name: mat?.material_name,
              unit: l.unit, quantity: l.quantity, s_status: "未审核",
              s_code: l.retrievalCode, man_address: l.origin, packing: l.packaging,
              batch_no: l.batchNo, supplier: p.supplierId, memo: l.note,
            },
          });
        }
      }
    });
    res.status(201).json({ id: docId, docNo: docId, status: "DRAFT" });
  });

  // 修改 (仅未审核)
  router.put("/:id", async (req, res) => {
    const found = await findDoc(String(req.params.id));
    if (!found) return res.status(404).json({ error: "单据不存在" });
    if (found.doc.s_status === "已审核") return res.status(409).json({ error: "已审核单据不能修改，请先取消审核" });
    const p = parseBody(req.body);
    if (typeof p === "string") return res.status(400).json({ error: p });
    const id = String(req.params.id);

    await db.$transaction(async (tx) => {
      if (found.kind === "in") {
        await tx.t_stock_in_detail.deleteMany({ where: { in_id: id } });
        await tx.t_stock_in.update({
          where: { in_id: id },
          data: { stock: p.warehouseId, date_time: p.date, car_no2: p.vehicleNo, memo: p.remark, in_cust: p.customerId },
        });
        let i = 0;
        for (const l of p.lines) {
          const mat = await tx.t_a_material.findUnique({ where: { material_id: l.materialId } });
          await tx.t_stock_in_detail.create({
            data: {
              in_detail: `${id}D${String(++i).padStart(2, "0")}`, in_id: id,
              material_id: l.materialId, material_no: mat?.material_no, material_name: mat?.material_name,
              unit: l.unit, quantity: l.quantity, s_status: "未审核",
              s_code: l.retrievalCode, man_address: l.origin, packing: l.packaging,
              batch_no: l.batchNo, supplier: p.supplierId, memo: l.note,
            },
          });
        }
      } else {
        await tx.t_stock_out_detail.deleteMany({ where: { out_id: id } });
        await tx.t_stock_out.update({
          where: { out_id: id },
          data: { stock: p.warehouseId, date_time: p.date, car_no: p.vehicleNo, memo: p.remark, cust: p.customerId },
        });
        let i = 0;
        for (const l of p.lines) {
          const mat = await tx.t_a_material.findUnique({ where: { material_id: l.materialId } });
          await tx.t_stock_out_detail.create({
            data: {
              out_detail: `${id}D${String(++i).padStart(2, "0")}`, out_id: id,
              material_id: l.materialId, material_no: mat?.material_no, material_name: mat?.material_name,
              unit: l.unit, quantity: l.quantity, s_status: "未审核",
              s_code: l.retrievalCode, man_address: l.origin, packing: l.packaging,
              batch_no: l.batchNo, supplier: p.supplierId, memo: l.note,
            },
          });
        }
      }
    });
    res.json({ id, docNo: id, status: "DRAFT" });
  });

  // 删除 (仅未审核)
  router.delete("/:id", async (req, res) => {
    const found = await findDoc(String(req.params.id));
    if (!found) return res.status(404).json({ error: "单据不存在" });
    if (found.doc.s_status === "已审核") return res.status(409).json({ error: "已审核单据不能删除，请先取消审核" });
    const id = String(req.params.id);
    await db.$transaction(async (tx) => {
      if (found.kind === "in") {
        await tx.t_stock_in_detail.deleteMany({ where: { in_id: id } });
        await tx.t_stock_in.delete({ where: { in_id: id } });
      } else {
        await tx.t_stock_out_detail.deleteMany({ where: { out_id: id } });
        await tx.t_stock_out.delete({ where: { out_id: id } });
      }
    });
    res.json({ ok: true });
  });

  // 审核: 更新库存 (副本模拟)
  router.post("/:id/approve", async (req, res) => {
    const found = await findDoc(String(req.params.id));
    if (!found) return res.status(404).json({ error: "单据不存在" });
    if (found.doc.s_status === "已审核") return res.status(409).json({ error: "单据已审核" });
    const id = String(req.params.id);
    const person = req.user?.personnelId ?? "PN0010188";
    const stock = found.doc.stock;

    try {
      await db.$transaction(async (tx) => {
        if (found.kind === "out") {
          // 库存校验
          for (const d of found.details as any[]) {
            const sm = await tx.t_stock_material.findFirst({ where: { stock, material_id: d.material_id ?? "" } });
            if (!sm || Number(sm.quantity) < Number(d.quantity)) {
              throw new Error(`库存不足: ${d.material_no ?? d.material_id} 现有 ${sm ? Number(sm.quantity) : 0}, 需要 ${Number(d.quantity)}`);
            }
          }
        }
        for (const d of found.details as any[]) {
          const matId = d.material_id ?? "";
          const qty = Number(d.quantity);
          const sm = await tx.t_stock_material.findFirst({ where: { stock, material_id: matId } });
          const delta = found.kind === "in" ? qty : -qty;
          if (sm) {
            await tx.t_stock_material.updateMany({
              where: { stock, material_id: matId },
              data: { quantity: Number(sm.quantity) + delta, time_quantity: Number(sm.time_quantity) + delta, date_time: new Date() },
            });
          } else {
            await tx.t_stock_material.create({
              data: { stock, material_id: matId, quantity: delta, time_quantity: delta, date_time: new Date() },
            });
          }

          if (found.kind === "in") {
            const mbId = `MB${d.in_detail}`.slice(0, 50);
            await tx.t_material_batch.create({
              data: {
                material_batch_id: mbId, material_id: matId, batch_no: d.batch_no,
                in_quantity: qty, out_quantity: 0, left_quantity: qty,
                s_code: d.s_code, man_address: d.man_address, supplier: d.supplier, stock,
              },
            });
            await tx.t_stock_in_detail.update({ where: { in_detail: d.in_detail }, data: { material_batch_id: mbId, s_status: "已审核" } });
          } else {
            // FIFO 扣减批次
            let remain = qty;
            const batches = await tx.t_material_batch.findMany({
              where: { stock, material_id: matId, left_quantity: { gt: 0 } },
              orderBy: { entry_time: "asc" },
            });
            for (const b of batches) {
              if (remain <= 0) break;
              const take = Math.min(Number(b.left_quantity), remain);
              await tx.t_material_batch.update({
                where: { material_batch_id: b.material_batch_id },
                data: { left_quantity: Number(b.left_quantity) - take, out_quantity: Number(b.out_quantity) + take },
              });
              remain -= take;
            }
            await tx.t_stock_out_detail.update({ where: { out_detail: d.out_detail }, data: { s_status: "已审核" } });
          }
        }
        if (found.kind === "in") {
          await tx.t_stock_in.update({ where: { in_id: id }, data: { s_status: "已审核", audit_person: person, audit_time: new Date() } });
        } else {
          await tx.t_stock_out.update({ where: { out_id: id }, data: { s_status: "已审核", audit_person: person, audit_time: new Date() } });
        }
      });
    } catch (e: any) {
      return res.status(409).json({ error: e.message ?? "审核失败" });
    }
    res.json({ id, status: "APPROVED" });
  });

  // 取消审核: 反向回滚库存 (副本模拟; 出库批次按新建调整批次回补)
  router.post("/:id/unapprove", async (req, res) => {
    const found = await findDoc(String(req.params.id));
    if (!found) return res.status(404).json({ error: "单据不存在" });
    if (found.doc.s_status !== "已审核") return res.status(409).json({ error: "单据未审核" });
    const id = String(req.params.id);
    const stock = found.doc.stock;

    try {
      await db.$transaction(async (tx) => {
        for (const d of found.details as any[]) {
          const matId = d.material_id ?? "";
          const qty = Number(d.quantity);
          const delta = found.kind === "in" ? -qty : qty;
          const sm = await tx.t_stock_material.findFirst({ where: { stock, material_id: matId } });
          const newQty = (sm ? Number(sm.quantity) : 0) + delta;
          if (newQty < 0) throw new Error(`取消审核会导致 ${d.material_no ?? matId} 库存为负 (${newQty})`);
          if (sm) {
            await tx.t_stock_material.updateMany({
              where: { stock, material_id: matId },
              data: { quantity: newQty, time_quantity: Number(sm.time_quantity) + delta, date_time: new Date() },
            });
          } else {
            await tx.t_stock_material.create({ data: { stock, material_id: matId, quantity: delta, time_quantity: delta, date_time: new Date() } });
          }
          if (found.kind === "in") {
            if (d.material_batch_id) {
              const b = await tx.t_material_batch.findUnique({ where: { material_batch_id: d.material_batch_id } });
              if (b && Number(b.left_quantity) < qty) throw new Error(`批次 ${b.batch_no ?? b.material_batch_id} 已被出库使用, 无法取消审核`);
              if (b) await tx.t_material_batch.delete({ where: { material_batch_id: d.material_batch_id } });
            }
            await tx.t_stock_in_detail.update({ where: { in_detail: d.in_detail }, data: { material_batch_id: null, s_status: "未审核" } });
          } else {
            await tx.t_material_batch.create({
              data: {
                material_batch_id: `MBADJ${d.out_detail}`.slice(0, 50), material_id: matId, batch_no: d.batch_no,
                in_quantity: qty, out_quantity: 0, left_quantity: qty,
                s_code: d.s_code, man_address: d.man_address, stock,
              },
            });
            await tx.t_stock_out_detail.update({ where: { out_detail: d.out_detail }, data: { s_status: "未审核" } });
          }
        }
        if (found.kind === "in") {
          await tx.t_stock_in.update({ where: { in_id: id }, data: { s_status: "未审核", audit_person: null, audit_time: null } });
        } else {
          await tx.t_stock_out.update({ where: { out_id: id }, data: { s_status: "未审核", audit_person: null, audit_time: null } });
        }
      });
    } catch (e: any) {
      return res.status(409).json({ error: e.message ?? "取消审核失败" });
    }
    res.json({ id, status: "DRAFT" });
  });
}
