// 真实结构单据写操作。所有查询与写入统一使用 CLOUD_DATABASE_URL。
// 库存维护逻辑是依据现有表结构实现的 Web 端版本，仍需与旧桌面客户端持续核对。
import { Router } from "express";
import { Prisma } from "../generated/cloud";
import { cloudPrisma as db } from "./prisma";

const S = Prisma.sql;
const MAX_BULK_APPROVAL = 100;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "审核失败";
}

export function parseBulkApprovalIds(body: unknown): string[] | string {
  if (typeof body !== "object" || body === null || !("ids" in body)) return "请选择需要审核的单据";
  const idsValue = (body as { ids: unknown }).ids;
  if (!Array.isArray(idsValue) || idsValue.length === 0) return "请选择需要审核的单据";
  if (idsValue.length > MAX_BULK_APPROVAL) return `一次最多审核 ${MAX_BULK_APPROVAL} 张单据`;
  const ids = [...new Set(idsValue.map((id) => String(id).trim()).filter(Boolean))];
  if (!ids.length) return "请选择需要审核的单据";
  return ids;
}

const quantity2 = (value: number) => Math.round(value * 100) / 100;
const inventoryKey = (stock: string, materialId: string) => `${stock}\u0000${materialId}`;
function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

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

interface MaterialBatchRow {
  material_batch_id: string;
  material_id: string | null;
  batch_no: string | null;
  in_quantity: unknown;
  out_quantity: unknown;
  left_quantity: unknown;
  entry_time: Date | null;
  s_code: string | null;
  man_address: string | null;
  supplier: string | null;
  stock: string | null;
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

  // 批量审核：一次请求、一个 Serializable 事务，按表执行集合式更新。
  router.post("/bulk-approve", async (req, res) => {
    const parsedIds = parseBulkApprovalIds(req.body);
    if (typeof parsedIds === "string") return res.status(400).json({ error: parsedIds });
    const ids = parsedIds;
    const person = req.user?.personnelId ?? "PN0010188";
    const auditTime = new Date();

    try {
      await db.$transaction(async (tx) => {
        const inDocs = await tx.t_stock_in.findMany({
          where: { in_id: { in: ids } },
          include: { t_stock_in_detail: true },
        });
        const outDocs = await tx.t_stock_out.findMany({
          where: { out_id: { in: ids } },
          include: { t_stock_out_detail: true },
        });

        const foundIds = new Set([
          ...inDocs.map((doc) => doc.in_id),
          ...outDocs.map((doc) => doc.out_id),
        ]);
        const missing = ids.filter((id) => !foundIds.has(id));
        if (missing.length) throw new Error(`单据不存在：${missing.slice(0, 10).join("、")}`);

        const approved = [
          ...inDocs.filter((doc) => doc.s_status === "已审核").map((doc) => doc.in_id),
          ...outDocs.filter((doc) => doc.s_status === "已审核").map((doc) => doc.out_id),
        ];
        if (approved.length) throw new Error(`单据已审核：${approved.slice(0, 10).join("、")}`);

        interface InventoryChange {
          stock: string;
          materialId: string;
          materialNo: string;
          delta: number;
          outbound: number;
        }
        const changes = new Map<string, InventoryChange>();
        const addChange = (
          stock: string,
          materialId: string,
          materialNo: string | null,
          quantity: number,
          direction: 1 | -1
        ) => {
          if (!materialId) throw new Error("单据明细缺少物料");
          if (!(quantity > 0)) throw new Error(`${materialNo || materialId} 的数量必须大于 0`);
          const key = inventoryKey(stock, materialId);
          const current = changes.get(key) ?? {
            stock,
            materialId,
            materialNo: materialNo || materialId,
            delta: 0,
            outbound: 0,
          };
          current.delta = quantity2(current.delta + direction * quantity);
          if (direction === -1) current.outbound = quantity2(current.outbound + quantity);
          changes.set(key, current);
        };

        for (const doc of inDocs) {
          if (!doc.t_stock_in_detail.length) throw new Error(`单据 ${doc.in_id} 没有明细`);
          for (const detail of doc.t_stock_in_detail) {
            addChange(doc.stock, detail.material_id, detail.material_no, Number(detail.quantity), 1);
          }
        }
        for (const doc of outDocs) {
          if (!doc.t_stock_out_detail.length) throw new Error(`单据 ${doc.out_id} 没有明细`);
          for (const detail of doc.t_stock_out_detail) {
            addChange(doc.stock, detail.material_id ?? "", detail.material_no, Number(detail.quantity), -1);
          }
        }

        const changeList = [...changes.values()];
        const stockRows = changeList.length
          ? await tx.t_stock_material.findMany({
              where: { OR: changeList.map((item) => ({ stock: item.stock, material_id: item.materialId })) },
            })
          : [];
        const stockByKey = new Map(stockRows.map((row) => [inventoryKey(row.stock, row.material_id), row]));
        const stockUpdates = changeList.map((item) => {
          const existing = stockByKey.get(inventoryKey(item.stock, item.materialId));
          const quantity = quantity2(Number(existing?.quantity ?? 0) + item.delta);
          const timeQuantity = quantity2(Number(existing?.time_quantity ?? 0) + item.delta);
          if (quantity < 0) {
            throw new Error(`库存不足：${item.materialNo} 现有 ${Number(existing?.quantity ?? 0)}，本批次净扣减 ${-item.delta}`);
          }
          return { ...item, quantity, timeQuantity };
        });

        const outboundChanges = changeList.filter((item) => item.outbound > 0);
        const existingBatches = outboundChanges.length
          ? await tx.$queryRaw<MaterialBatchRow[]>(S`
              SELECT material_batch_id, material_id, batch_no, in_quantity, out_quantity, left_quantity,
                     entry_time, s_code, man_address, supplier, stock
              FROM t_material_batch
              WHERE left_quantity > 0
                AND (${Prisma.join(
                  outboundChanges.map((item) => S`(stock = ${item.stock} AND material_id = ${item.materialId})`),
                  " OR "
                )})
              ORDER BY entry_time ASC, material_batch_id ASC
            `)
          : [];

        interface BatchState {
          id: string;
          key: string;
          left: number;
          out: number;
          isNew: boolean;
          materialId: string;
          batchNo: string | null;
          inQuantity: number;
          sCode: string | null;
          origin: string | null;
          supplier: string | null;
          stock: string;
        }
        const batchStates: BatchState[] = existingBatches.map((batch) => ({
          id: batch.material_batch_id,
          key: inventoryKey(batch.stock ?? "", batch.material_id ?? ""),
          left: Number(batch.left_quantity),
          out: Number(batch.out_quantity),
          isNew: false,
          materialId: batch.material_id ?? "",
          batchNo: batch.batch_no,
          inQuantity: Number(batch.in_quantity),
          sCode: batch.s_code,
          origin: batch.man_address,
          supplier: batch.supplier,
          stock: batch.stock ?? "",
        }));
        const inboundBatchLinks: { detailId: string; batchId: string }[] = [];
        for (const doc of inDocs) {
          for (const detail of doc.t_stock_in_detail) {
            const batchId = `MB${detail.in_detail}`.slice(0, 50);
            const quantity = Number(detail.quantity);
            inboundBatchLinks.push({ detailId: detail.in_detail, batchId });
            batchStates.push({
              id: batchId,
              key: inventoryKey(doc.stock, detail.material_id),
              left: quantity,
              out: 0,
              isNew: true,
              materialId: detail.material_id,
              batchNo: detail.batch_no,
              inQuantity: quantity,
              sCode: detail.s_code,
              origin: detail.man_address,
              supplier: detail.supplier,
              stock: doc.stock,
            });
          }
        }

        if (inboundBatchLinks.length) {
          const conflictingBatches = await tx.$queryRaw<{ material_batch_id: string }[]>(S`
            SELECT material_batch_id
            FROM t_material_batch
            WHERE material_batch_id IN (${Prisma.join(inboundBatchLinks.map((item) => S`${item.batchId}`))})
          `);
          if (conflictingBatches.length) {
            throw new Error(`批次编号已存在：${conflictingBatches.slice(0, 10).map((item) => item.material_batch_id).join("、")}`);
          }
        }

        for (const change of outboundChanges) {
          let remaining = change.outbound;
          for (const batch of batchStates) {
            if (batch.key !== inventoryKey(change.stock, change.materialId) || remaining <= 0) continue;
            const take = Math.min(batch.left, remaining);
            batch.left = quantity2(batch.left - take);
            batch.out = quantity2(batch.out + take);
            remaining = quantity2(remaining - take);
          }
          if (remaining > 0) {
            throw new Error(`批次库存不足：${change.materialNo} 仍缺少 ${remaining}`);
          }
        }

        const existingStockUpdates = stockUpdates.filter((item) =>
          stockByKey.has(inventoryKey(item.stock, item.materialId))
        );
        for (const updateChunk of chunks(existingStockUpdates, 300)) {
          const values = Prisma.join(updateChunk.map((item) =>
            S`(${item.stock}, ${item.materialId}, ${item.quantity}, ${item.timeQuantity}, ${auditTime})`
          ));
          await tx.$executeRaw(S`
              UPDATE target WITH (UPDLOCK, HOLDLOCK) SET
                target.quantity = source.quantity,
                target.time_quantity = source.time_quantity,
                target.date_time = source.date_time
              FROM t_stock_material AS target
              INNER JOIN (VALUES ${values}) AS source (stock, material_id, quantity, time_quantity, date_time)
                ON target.stock = source.stock AND target.material_id = source.material_id
            `);
        }
        const newStockRows = stockUpdates.filter((item) =>
          !stockByKey.has(inventoryKey(item.stock, item.materialId))
        );
        for (const insertChunk of chunks(newStockRows, 300)) {
          await tx.t_stock_material.createMany({
            data: insertChunk.map((item) => ({
              stock: item.stock,
              material_id: item.materialId,
              quantity: item.quantity,
              time_quantity: item.timeQuantity,
              date_time: auditTime,
            })),
          });
        }

        const newBatches = batchStates.filter((batch) => batch.isNew);
        for (const insertChunk of chunks(newBatches, 180)) {
          await tx.t_material_batch.createMany({
            data: insertChunk.map((batch) => ({
              material_batch_id: batch.id,
              material_id: batch.materialId,
              batch_no: batch.batchNo,
              in_quantity: batch.inQuantity,
              out_quantity: batch.out,
              left_quantity: batch.left,
              s_code: batch.sCode,
              man_address: batch.origin,
              supplier: batch.supplier,
              stock: batch.stock,
            })),
          });
        }

        const existingBatchOut = new Map(
          existingBatches.map((batch) => [batch.material_batch_id, Number(batch.out_quantity)])
        );
        const changedExistingBatches = batchStates.filter((batch) =>
          !batch.isNew && batch.out > (existingBatchOut.get(batch.id) ?? 0)
        );
        for (const updateChunk of chunks(changedExistingBatches, 600)) {
          const values = Prisma.join(updateChunk.map((batch) => S`(${batch.id}, ${batch.left}, ${batch.out})`));
          await tx.$executeRaw(S`
            UPDATE target SET
              target.left_quantity = source.left_quantity,
              target.out_quantity = source.out_quantity
            FROM t_material_batch AS target
            INNER JOIN (VALUES ${values}) AS source (material_batch_id, left_quantity, out_quantity)
              ON target.material_batch_id = source.material_batch_id
          `);
        }

        for (const updateChunk of chunks(inboundBatchLinks, 800)) {
          const values = Prisma.join(updateChunk.map((item) => S`(${item.detailId}, ${item.batchId})`));
          await tx.$executeRaw(S`
            UPDATE target SET
              target.material_batch_id = source.material_batch_id,
              target.s_status = N'已审核'
            FROM t_stock_in_detail AS target
            INNER JOIN (VALUES ${values}) AS source (in_detail, material_batch_id)
              ON target.in_detail = source.in_detail
          `);
        }

        const inIds = inDocs.map((doc) => doc.in_id);
        const outIds = outDocs.map((doc) => doc.out_id);
        if (inIds.length) {
          await tx.t_stock_in.updateMany({
            where: { in_id: { in: inIds } },
            data: { s_status: "已审核", audit_person: person, audit_time: auditTime },
          });
        }
        if (outIds.length) {
          await tx.t_stock_out_detail.updateMany({
            where: { out_id: { in: outIds } },
            data: { s_status: "已审核" },
          });
          await tx.t_stock_out.updateMany({
            where: { out_id: { in: outIds } },
            data: { s_status: "已审核", audit_person: person, audit_time: auditTime },
          });
        }
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 60_000,
      });
    } catch (error: unknown) {
      return res.status(409).json({ error: errorText(error) });
    }

    res.json({ approvedIds: ids, count: ids.length, status: "APPROVED" });
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
            const batches = await tx.$queryRaw<MaterialBatchRow[]>(S`
              SELECT material_batch_id, material_id, batch_no, in_quantity, out_quantity, left_quantity,
                     entry_time, s_code, man_address, supplier, stock
              FROM t_material_batch
              WHERE stock = ${stock} AND material_id = ${matId} AND left_quantity > 0
              ORDER BY entry_time ASC, material_batch_id ASC
            `);
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
