import { prisma } from "../prisma";
import { direction } from "./docTypes";

export interface StockRow {
  warehouseId: number;
  warehouseName: string;
  materialId: number;
  materialCode: string;
  materialName: string;
  category: string;
  categoryName?: string;
  unit: string;
  supplier?: string | null;
  supplierName?: string;
  batchNo: string | null;
  retrievalCode: string | null;
  origin: string | null;
  inQuantity: number;
  outQuantity: number;
  quantity: number;
}

// 即时库存：汇总所有单据（包括未审核），不读取库存快照字段。
// 本地模式采用内存聚合；生产库的只读 SQL 实现在 cloud/router.ts。
export async function computeStock(opts: {
  warehouseIds?: number[];
  suppliers?: string[];
  origins?: string[];
  categories?: string[];
  q?: string;
  byBatch?: boolean;
  excludeDocumentId?: number;
}): Promise<StockRow[]> {
  const lines = await prisma.documentLine.findMany({
    where: {
      document: {
        ...(opts.warehouseIds?.length ? { warehouseId: { in: opts.warehouseIds } } : {}),
        ...(opts.excludeDocumentId ? { id: { not: opts.excludeDocumentId } } : {}),
      },
      ...(opts.categories?.length ? { material: { category: { in: opts.categories } } } : {}),
    },
    include: {
      document: {
        select: {
          docType: true,
          date: true,
          warehouseId: true,
          warehouse: { select: { name: true } },
          supplierId: true,
          supplier: { select: { name: true } },
        },
      },
      material: { select: { code: true, name: true, category: true, unit: true } },
    },
    orderBy: { document: { date: "desc" } },
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
        supplier: l.document.supplierId != null ? String(l.document.supplierId) : null,
        supplierName: l.document.supplier?.name ?? "",
        batchNo: opts.byBatch ? l.batchNo : null,
        retrievalCode: opts.byBatch ? l.retrievalCode : null,
        origin: l.origin,
        inQuantity: 0,
        outQuantity: 0,
        quantity: 0,
      };
      map.set(key, row);
    }
    if (!row.supplier && l.document.supplierId != null) {
      row.supplier = String(l.document.supplierId);
      row.supplierName = l.document.supplier?.name ?? "";
    }
    if (!row.origin && l.origin) row.origin = l.origin;
    if (dir > 0) row.inQuantity += Number(l.quantity);
    else row.outQuantity += Number(l.quantity);
    row.quantity += dir * Number(l.quantity);
  }

  const text = opts.q?.toLocaleLowerCase() ?? "";
  return [...map.values()]
    .filter((row) => row.quantity !== 0)
    .filter((row) => !opts.suppliers?.length || (row.supplier != null && opts.suppliers.includes(row.supplier)))
    .filter((row) => !opts.origins?.length || (row.origin != null && opts.origins.includes(row.origin)))
    .filter((row) => !text || `${row.materialCode} ${row.materialName}`.toLocaleLowerCase().includes(text))
    .sort((a, b) => a.materialCode.localeCompare(b.materialCode) || a.warehouseName.localeCompare(b.warehouseName));
}

// 校验出库/盘亏审核后库存是否为负
export async function checkSufficientStock(docId: number): Promise<string[]> {
  const doc = await prisma.document.findUniqueOrThrow({
    where: { id: docId },
    include: { lines: { include: { material: true } } },
  });
  if (direction(doc.docType) >= 0) return [];
  const stock = await computeStock({ warehouseIds: [doc.warehouseId], excludeDocumentId: doc.id });
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
