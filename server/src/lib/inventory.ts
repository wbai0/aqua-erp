import { prisma } from "../prisma";
import { direction } from "./docTypes";

export interface StockRow {
  warehouseId: number;
  warehouseName: string;
  materialId: number;
  materialCode: string;
  materialName: string;
  category: string;
  unit: string;
  batchNo: string | null;
  retrievalCode: string | null;
  origin: string | null;
  quantity: number;
}

// 即时库存: 汇总所有已审核单据.
// v1 采用内存聚合, 数据量增大后可改为 SQL 聚合或库存快照表.
export async function computeStock(opts: {
  warehouseId?: number;
  materialId?: number;
  category?: string;
  byBatch?: boolean;
}): Promise<StockRow[]> {
  const lines = await prisma.documentLine.findMany({
    where: {
      document: {
        status: "APPROVED",
        ...(opts.warehouseId ? { warehouseId: opts.warehouseId } : {}),
      },
      ...(opts.materialId ? { materialId: opts.materialId } : {}),
      ...(opts.category ? { material: { category: opts.category } } : {}),
    },
    include: {
      document: { select: { docType: true, warehouseId: true, warehouse: { select: { name: true } } } },
      material: { select: { code: true, name: true, category: true, unit: true } },
    },
  });

  const map = new Map<string, StockRow>();
  for (const l of lines) {
    const dir = direction(l.document.docType);
    if (dir === 0) continue;
    const batchKey = opts.byBatch ? `|${l.batchNo ?? ""}|${l.retrievalCode ?? ""}` : "";
    const key = `${l.document.warehouseId}|${l.materialId}${batchKey}`;
    let row = map.get(key);
    if (!row) {
      row = {
        warehouseId: l.document.warehouseId,
        warehouseName: l.document.warehouse.name,
        materialId: l.materialId,
        materialCode: l.material.code,
        materialName: l.material.name,
        category: l.material.category,
        unit: l.material.unit,
        batchNo: opts.byBatch ? l.batchNo : null,
        retrievalCode: opts.byBatch ? l.retrievalCode : null,
        origin: opts.byBatch ? l.origin : null,
        quantity: 0,
      };
      map.set(key, row);
    }
    row.quantity += dir * Number(l.quantity);
  }
  return [...map.values()].sort((a, b) => a.materialCode.localeCompare(b.materialCode));
}

// 校验出库/盘亏审核后库存是否为负
export async function checkSufficientStock(docId: number): Promise<string[]> {
  const doc = await prisma.document.findUniqueOrThrow({
    where: { id: docId },
    include: { lines: { include: { material: true } } },
  });
  if (direction(doc.docType) >= 0) return [];
  const stock = await computeStock({ warehouseId: doc.warehouseId });
  const errors: string[] = [];
  const need = new Map<number, number>();
  for (const l of doc.lines) {
    need.set(l.materialId, (need.get(l.materialId) ?? 0) + Number(l.quantity));
  }
  for (const [materialId, qty] of need) {
    const row = stock.find((s) => s.materialId === materialId);
    const available = row?.quantity ?? 0;
    if (available < qty) {
      const m = doc.lines.find((l) => l.materialId === materialId)!.material;
      errors.push(`${m.code} ${m.name}: 库存 ${available} ${m.unit}, 需要 ${qty} ${m.unit}`);
    }
  }
  return errors;
}
