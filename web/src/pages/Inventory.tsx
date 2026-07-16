import { useCallback, useEffect, useMemo, useState } from "react";
import { Input, Segmented, Select, Switch } from "antd";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, ValueFormatterParams } from "ag-grid-community";
import { api, CATEGORY_LABELS, StockRow } from "../api";
import { useMeta } from "../App";
import { gridTheme, gridDefaultColDef } from "../components/agGrid";

const numFmt = (p: ValueFormatterParams) =>
  p.value == null || p.value === "" ? "" : Number(p.value).toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function Inventory() {
  const meta = useMeta();
  const [rows, setRows] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [byBatch, setByBatch] = useState(false);

  // antd 多选筛选 —— 任一变化都会带参数去后端重新查
  const [fWarehouses, setFWarehouses] = useState<string[]>([]);
  const [fSuppliers, setFSuppliers] = useState<string[]>([]);
  const [fOrigins, setFOrigins] = useState<string[]>([]);
  const [fCategories, setFCategories] = useState<string[]>([]);
  const [fText, setFText] = useState(""); // 已提交的搜索词
  const [textInput, setTextInput] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ rows: StockRow[] }>("/inventory", {
        query: {
          byBatch: byBatch ? "1" : undefined,
          warehouseIds: fWarehouses.join(",") || undefined,
          suppliers: fSuppliers.join(",") || undefined,
          origins: fOrigins.join(",") || undefined,
          categories: fCategories.join(",") || undefined,
          q: fText || undefined,
        },
      });
      setRows(res.rows);
    } finally {
      setLoading(false);
    }
  }, [byBatch, fWarehouses, fSuppliers, fOrigins, fCategories, fText]);

  useEffect(() => {
    load();
  }, [load]);

  const catLabel = (c: string, name?: string) => name || CATEGORY_LABELS[c] || c;

  const categoryOpts = useMemo(
    () => [...new Map(meta.materials.map((m) => [m.category, m.categoryName ?? m.category])).entries()],
    [meta.materials]
  );

  // 底部合计行：按计量单位分别合计(千克/袋不能混加)，随当前筛选结果实时变化
  const totalRows = useMemo(() => {
    const byUnit = new Map<string, { qty: number; inQ: number; outQ: number; packQ: number }>();
    for (const r of rows) {
      const t = byUnit.get(r.unit) ?? { qty: 0, inQ: 0, outQ: 0, packQ: 0 };
      t.qty += r.quantity;
      t.inQ += r.inQuantity ?? 0;
      t.outQ += r.outQuantity ?? 0;
      t.packQ += r.packQty ?? 0;
      byUnit.set(r.unit, t);
    }
    return [...byUnit.entries()].map(([unit, t]) => ({
      warehouseId: "__total__",
      materialId: `__total__${unit}`,
      warehouseName: "",
      materialCode: "",
      materialName: "",
      category: "",
      supplierName: `合计（${unit}）`,
      origin: null,
      batchNo: null,
      retrievalCode: null,
      unit,
      quantity: Math.round(t.qty * 100) / 100,
      inQuantity: Math.round(t.inQ * 100) / 100,
      outQuantity: Math.round(t.outQ * 100) / 100,
      packQty: Math.round(t.packQ * 100) / 100,
    })) as StockRow[];
  }, [rows]);

  const colDefs = useMemo<ColDef<StockRow>[]>(() => {
    const cols: ColDef<StockRow>[] = [
      { headerName: "#", width: 58, pinned: "left", sortable: false, resizable: false, valueGetter: (p) => (p.node?.rowPinned ? "" : (p.node?.rowIndex ?? 0) + 1) },
      { headerName: "供应商", field: "supplierName", width: 100, pinned: "left" },
      { headerName: "仓库", field: "warehouseName", width: 100 },
      { headerName: "物料编码", field: "materialCode", width: 140, cellClass: "num" },
      { headerName: "品名", field: "materialName", width: 120 },
      { headerName: "简称", field: "shortName", width: 84 },
      { headerName: "类别", width: 100, valueGetter: (p) => (p.data ? catLabel(p.data.category, p.data.categoryName) : "") },
      { headerName: "产地", field: "origin", width: 100 },
      { headerName: "水分", field: "moisture", width: 80 },
    ];
    if (byBatch) {
      cols.push(
        { headerName: "批次/车次", field: "batchNo", width: 110 },
        { headerName: "检索码", field: "retrievalCode", width: 140, cellClass: "num" }
      );
    }
    cols.push(
      {
        headerName: "入库累计", field: "inQuantity", width: 118, type: "rightAligned", valueFormatter: numFmt,
      },
      {
        headerName: "出库累计", field: "outQuantity", width: 118, type: "rightAligned", valueFormatter: numFmt,
      },
      {
        headerName: "库存数量", field: "quantity", width: 122, type: "rightAligned", valueFormatter: numFmt,
        cellStyle: (p) => ({ fontWeight: 600, color: Number(p.value) < 0 ? "#cb2634" : "inherit" }),
      },
      { headerName: "计量单位", field: "unit", width: 92 },
      { headerName: "包装规格", field: "packSpec", width: 102, type: "rightAligned", valueFormatter: numFmt },
      { headerName: "包装单位", field: "packUnit", width: 92 },
      { headerName: "包装数量", field: "packQty", width: 104, type: "rightAligned", valueFormatter: numFmt }
    );
    return cols;
  }, [byBatch]);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">即时库存</h1>
        <span>
          按批次 <Switch checked={byBatch} onChange={setByBatch} />
        </span>
      </div>

      <div style={{ color: "var(--text-2)", fontSize: 13, margin: "-4px 0 10px" }}>
        共 {rows.length} 条库存 · 所有入库与出库单实时计算（包含未审核）
        {byBatch ? " · 批次结余按明细的批次链接计算" : ""}
      </div>

      <div className="filter-bar" style={{ flexWrap: "wrap", gap: 8 }}>
        <Select
          mode="multiple" allowClear showSearch optionFilterProp="label" maxTagCount="responsive"
          style={{ minWidth: 180 }} placeholder="供应商" value={fSuppliers} onChange={setFSuppliers}
          options={meta.suppliers.map((s) => ({ value: String(s.id), label: s.name }))}
        />
        <Select
          mode="multiple" allowClear showSearch optionFilterProp="label" maxTagCount="responsive"
          style={{ minWidth: 160 }} placeholder="产地" value={fOrigins} onChange={setFOrigins}
          options={(meta.origins ?? []).map((o) => ({ value: String(o.id), label: o.name }))}
        />
        <Select
          mode="multiple" allowClear showSearch optionFilterProp="label" maxTagCount="responsive"
          style={{ minWidth: 150 }} placeholder="仓库" value={fWarehouses} onChange={setFWarehouses}
          options={meta.warehouses.map((w) => ({ value: String(w.id), label: w.name }))}
        />
        <Select
          mode="multiple" allowClear maxTagCount="responsive"
          style={{ minWidth: 160 }} placeholder="类别" value={fCategories} onChange={setFCategories}
          options={categoryOpts.map(([c, name]) => ({ value: c, label: name }))}
        />
        <Input.Search
          allowClear style={{ width: 200 }} placeholder="物料编码 / 品名（回车）"
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          onSearch={(v) => setFText(v.trim())}
        />
      </div>

      <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ height: "calc(100dvh - 258px)", minHeight: 440, width: "100%" }}>
          <AgGridReact<StockRow>
            theme={gridTheme}
            rowData={rows}
            columnDefs={colDefs}
            defaultColDef={gridDefaultColDef}
            loading={loading}
            pagination
            paginationPageSize={50}
            paginationPageSizeSelector={[25, 50, 100]}
            animateRows
            overlayNoRowsTemplate="<span>暂无库存数据</span>"
            pinnedBottomRowData={totalRows}
            getRowStyle={(p) =>
              p.node.rowPinned ? { fontWeight: 700, background: "#f2f6ff" } : undefined
            }
            getRowId={(p) => `${p.data.warehouseId}-${p.data.materialId}-${p.data.batchNo ?? ""}-${p.data.retrievalCode ?? ""}`}
          />
        </div>
      </div>
    </div>
  );
}
