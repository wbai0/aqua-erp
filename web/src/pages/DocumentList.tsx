import { useCallback, useEffect, useMemo, useState } from "react";
import { DatePicker, Empty, Segmented, Select, Spin } from "antd";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, ValueFormatterParams } from "ag-grid-community";
import { useNavigate, useSearchParams } from "react-router-dom";
import dayjs, { Dayjs } from "dayjs";
import { api, Doc, Id } from "../api";
import { useIsDesktop, useMeta } from "../App";
import { gridTheme } from "../components/agGrid";

const GROUPS = [
  { value: "in", label: "入库" },
  { value: "out", label: "出库" },
  { value: "stocktake", label: "盘点" },
];

export default function DocumentList() {
  const meta = useMeta();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const [searchParams, setSearchParams] = useSearchParams();

  const group = searchParams.get("group") ?? "in";
  const groupTypes = useMemo(() => meta.docTypes.filter((t) => t.group === group), [meta.docTypes, group]);
  const typeLabels = useMemo(() => new Map(meta.docTypes.map((t) => [t.key, t.label])), [meta.docTypes]);
  const typeFilter = searchParams.get("type") || undefined; // 未选 = 该分组全部类型

  const [items, setItems] = useState<Doc[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [supplierId, setSupplierId] = useState<Id>();
  const [customerId, setCustomerId] = useState<Id>();
  const [materialId, setMaterialId] = useState<Id>();
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);

  function updateSearch(changes: Record<string, string | undefined>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setSearchParams(next);
  }

  const load = useCallback(async () => {
    const docType = typeFilter ?? groupTypes.map((t) => t.key).join(",");
    if (!docType) return;
    setLoading(true);
    try {
      const res = await api<{ total: number; items: Doc[] }>("/documents", {
        query: {
          docType,
          supplierId,
          customerId,
          materialId,
          dateFrom: range?.[0] ? range[0].format("YYYY-MM-DD") : undefined,
          dateTo: range?.[1] ? range[1].format("YYYY-MM-DD") : undefined,
          pageSize: 100,
        },
      });
      setItems(res.items);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, [typeFilter, groupTypes, supplierId, customerId, materialId, range]);

  useEffect(() => {
    load();
  }, [load]);

  const firstLine = (d: Doc) => d.lines[0];
  const qtyText = (d: Doc) => {
    const units = [...new Set(d.lines.map((l) => l.unit))];
    const qty = d.lines.reduce((s, l) => s + Number(l.quantity), 0);
    return `${qty.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${units.join("/")}`;
  };
  const packQtyText = (d: Doc) => {
    const totals = new Map<string, number>();
    for (const line of d.lines) {
      if (line.packQuantity == null || line.packQuantity === "") continue;
      const unit = line.packUnit ?? "";
      totals.set(unit, (totals.get(unit) ?? 0) + Number(line.packQuantity));
    }
    if (totals.size === 0) return "—";
    return [...totals.entries()]
      .map(([unit, quantity]) => `${quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ""}`)
      .join(" / ");
  };

  const columns = useMemo<ColDef<Doc>[]>(() => [
    { headerName: "单据编号", field: "docNo", width: 170, pinned: "left", cellClass: "num" },
    {
      headerName: "审核状态", width: 100,
      valueGetter: (p) => p.data?.status === "APPROVED" ? "已审核" : "未审核",
      cellStyle: (p) => ({ color: p.data?.status === "APPROVED" ? "#23923d" : "#d97917", fontWeight: 600 }),
    },
    {
      headerName: "类型", width: 120,
      valueGetter: (p) => p.data ? typeLabels.get(p.data.docType) ?? p.data.docType : "",
    },
    {
      headerName: "日期", field: "date", width: 116, sort: "desc",
      valueFormatter: (p: ValueFormatterParams<Doc, string>) => p.value ? dayjs(p.value).format("YYYY-MM-DD") : "",
    },
    { headerName: "仓库", width: 105, valueGetter: (p) => p.data?.warehouse?.name ?? "" },
    {
      headerName: group === "in" ? "供应商" : group === "out" ? "客户" : "往来单位", width: 120,
      valueGetter: (p) => p.data?.supplier?.name ?? p.data?.customer?.name ?? "—",
    },
    { headerName: "制单人", width: 105, valueGetter: (p) => p.data?.createdBy?.displayName ?? "—" },
    { headerName: "车次", field: "vehicleNo", width: 100, valueFormatter: (p) => p.value ?? "—" },
    {
      headerName: "检索码", width: 145, cellClass: "num",
      valueGetter: (p) => p.data ? firstLine(p.data)?.retrievalCode ?? "—" : "",
    },
    {
      headerName: "批次号", width: 110, cellClass: "num",
      valueGetter: (p) => p.data ? firstLine(p.data)?.batchNo ?? "—" : "",
    },
    {
      headerName: "产地", width: 105,
      valueGetter: (p) => p.data ? firstLine(p.data)?.origin ?? "—" : "",
    },
    {
      headerName: "物料编码", width: 145, cellClass: "num",
      valueGetter: (p) => p.data ? firstLine(p.data)?.material?.code ?? "—" : "",
    },
    {
      headerName: "品名", width: 145,
      valueGetter: (p) => {
        if (!p.data) return "";
        const line = firstLine(p.data);
        if (!line) return "—";
        return `${line.material?.name ?? ""}${p.data.lines.length > 1 ? ` 等${p.data.lines.length}项` : ""}`;
      },
    },
    {
      headerName: "规格", width: 110,
      valueGetter: (p) => p.data ? firstLine(p.data)?.spec ?? "—" : "",
    },
    {
      headerName: "数量", width: 135, type: "rightAligned", cellClass: "num",
      valueGetter: (p) => p.data?.lines.reduce((sum, line) => sum + Number(line.quantity), 0) ?? 0,
      valueFormatter: (p: ValueFormatterParams<Doc, number>) => p.data ? qtyText(p.data) : "",
    },
    {
      headerName: "件数", width: 120, type: "rightAligned", cellClass: "num",
      valueGetter: (p) => p.data ? packQtyText(p.data) : "",
    },
    {
      headerName: "工艺", width: 100,
      valueGetter: (p) => p.data ? firstLine(p.data)?.tech ?? "—" : "",
    },
    {
      headerName: "包装物", width: 120,
      valueGetter: (p) => p.data ? firstLine(p.data)?.packaging ?? "—" : "",
    },
    {
      headerName: "明细备注", width: 160,
      valueGetter: (p) => p.data ? firstLine(p.data)?.note ?? "—" : "",
    },
    { headerName: "单据备注", field: "remark", width: 160, valueFormatter: (p) => p.value ?? "—" },
  ], [group, typeLabels]);

  const documentGridDefaultColDef = useMemo<ColDef<Doc>>(() => ({
    sortable: true,
    filter: true,
    resizable: true,
    minWidth: 70,
  }), []);

  return (
    <div>
      <div className="page-header">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <h1 className="page-title">单据管理</h1>
          <Segmented
            value={group}
            options={GROUPS}
            onChange={(v) => updateSearch({ group: String(v), type: undefined })}
          />
        </div>
      </div>

      <div className="panel">
        <div className="filter-bar" style={{ marginBottom: 0, flexWrap: "wrap", gap: 8 }}>
          <Select
            allowClear showSearch optionFilterProp="label" style={{ minWidth: 150 }}
            placeholder="单据类型 (全部)"
            value={typeFilter}
            onChange={(v) => updateSearch({ type: v || undefined })}
            options={groupTypes.map((t) => ({ value: t.key, label: t.label }))}
          />
          {group === "in" && (
            <Select
              allowClear showSearch optionFilterProp="label" style={{ minWidth: 140 }}
              placeholder="供应商" value={supplierId} onChange={setSupplierId}
              options={meta.suppliers.map((s) => ({ value: s.id, label: s.name }))}
            />
          )}
          {group === "out" && (
            <Select
              allowClear showSearch optionFilterProp="label" style={{ minWidth: 140 }}
              placeholder="客户" value={customerId} onChange={setCustomerId}
              options={meta.customers.map((c) => ({ value: c.id, label: c.name }))}
            />
          )}
          <Select
            allowClear showSearch optionFilterProp="label" style={{ minWidth: 160 }}
            placeholder="物料" value={materialId} onChange={setMaterialId}
            options={meta.materials.map((m) => ({ value: m.id, label: `${m.code} ${m.name}` }))}
          />
          <DatePicker.RangePicker value={range as any} onChange={(v) => setRange(v as any)} placeholder={["日期从", "到"]} />
        </div>
      </div>

      {!isDesktop && loading ? (
        <div style={{ textAlign: "center", padding: 40 }}>
          <Spin />
        </div>
      ) : !isDesktop && items.length === 0 ? (
        <div className="panel">
          <Empty description="暂无单据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </div>
      ) : isDesktop ? (
        <div className="panel document-grid-panel">
          <div className="document-grid">
            <AgGridReact<Doc>
              theme={gridTheme}
              rowData={items}
              columnDefs={columns}
              defaultColDef={documentGridDefaultColDef}
              loading={loading}
              pagination
              paginationPageSize={25}
              paginationPageSizeSelector={[25, 50, 100]}
              animateRows
              getRowId={(p) => String(p.data.id)}
              onRowClicked={(event) => event.data && navigate(`/documents/${event.data.id}`)}
              overlayNoRowsTemplate="<span>暂无单据</span>"
            />
          </div>
        </div>
      ) : (
        <>
          <div style={{ color: "#8c8c8c", fontSize: 13, marginBottom: 8 }}>共 {total} 条</div>
          {items.map((doc) => (
            <div key={String(doc.id)} className="doc-card" onClick={() => navigate(`/documents/${doc.id}`)}>
              <div className="doc-card-top">
                <span className="doc-no">{doc.docNo}</span>
                <span style={{ color: "#0958d9", fontSize: 13 }}>{typeLabels.get(doc.docType) ?? doc.docType}</span>
              </div>
              <div className="doc-meta">
                <span>{dayjs(doc.date).format("YYYY-MM-DD")}</span>
                <span>{doc.warehouse?.name}</span>
                {doc.supplier && <span>{doc.supplier.name}</span>}
                {doc.customer && <span>{doc.customer.name}</span>}
                {doc.vehicleNo && <span>车次 {doc.vehicleNo}</span>}
                {firstLine(doc)?.retrievalCode && <span>{firstLine(doc)!.retrievalCode}</span>}
              </div>
              <div className="doc-qty">{qtyText(doc)}</div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
