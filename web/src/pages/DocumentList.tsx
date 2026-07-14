import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, DatePicker, Dropdown, Empty, Segmented, Select, Spin, Table, Tag } from "antd";
import { DownOutlined, PlusOutlined } from "@ant-design/icons";
import { useNavigate, useSearchParams } from "react-router-dom";
import dayjs, { Dayjs } from "dayjs";
import { api, Doc, Id } from "../api";
import { useIsDesktop, useMeta } from "../App";

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
  const canWrite = meta.capabilities?.canWriteDocs !== false;

  const group = searchParams.get("group") ?? "in";
  const groupTypes = useMemo(() => meta.docTypes.filter((t) => t.group === group), [meta.docTypes, group]);
  const typeLabels = useMemo(() => new Map(meta.docTypes.map((t) => [t.key, t.label])), [meta.docTypes]);
  const typeFilter = searchParams.get("type") || undefined; // 未选 = 该分组全部类型

  const [items, setItems] = useState<Doc[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [supplierId, setSupplierId] = useState<Id>();
  const [materialId, setMaterialId] = useState<Id>();
  const [status, setStatus] = useState<string>();
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);

  const load = useCallback(async () => {
    const docType = typeFilter ?? groupTypes.map((t) => t.key).join(",");
    if (!docType) return;
    setLoading(true);
    try {
      const res = await api<{ total: number; items: Doc[] }>("/documents", {
        query: {
          docType,
          supplierId: supplierId as any,
          materialId: materialId as any,
          status,
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
  }, [typeFilter, groupTypes, supplierId, materialId, status, range]);

  useEffect(() => {
    load();
  }, [load]);

  const statusTag = (s: string) => (
    <Tag color={s === "APPROVED" ? "green" : "orange"} style={{ margin: 0 }}>
      {s === "APPROVED" ? "已审核" : "未审核"}
    </Tag>
  );

  return (
    <div>
      <div className="page-header">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <h1 className="page-title">单据管理</h1>
          <Segmented value={group} options={GROUPS} onChange={(v) => setSearchParams({ group: String(v) })} />
        </div>
        {canWrite && (
          <Dropdown
            menu={{
              items: groupTypes.map((t) => ({ key: t.key, label: t.label })),
              onClick: ({ key }) => navigate(`/documents/new?type=${key}`),
            }}
          >
            <Button type="primary" icon={<PlusOutlined />}>
              新单 <DownOutlined style={{ fontSize: 11 }} />
            </Button>
          </Dropdown>
        )}
      </div>

      <div className="panel">
        <div className="filter-bar" style={{ marginBottom: 0 }}>
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="单据类型 (全部)"
            value={typeFilter}
            onChange={(v) =>
              setSearchParams(v ? { group, type: v } : { group })
            }
            options={groupTypes.map((t) => ({ value: t.key, label: t.label }))}
          />
          {group === "in" && (
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="供应商"
              value={supplierId}
              onChange={setSupplierId}
              options={meta.suppliers.map((s) => ({ value: s.id, label: s.name }))}
            />
          )}
          <Select
            allowClear
            placeholder="物料"
            value={materialId}
            onChange={setMaterialId}
            showSearch
            optionFilterProp="label"
            options={meta.materials.map((m) => ({ value: m.id, label: `${m.code} ${m.name}` }))}
          />
          <Select
            allowClear
            placeholder="状态"
            value={status}
            onChange={setStatus}
            options={[
              { value: "DRAFT", label: "未审核" },
              { value: "APPROVED", label: "已审核" },
            ]}
          />
          <DatePicker.RangePicker value={range as any} onChange={(v) => setRange(v as any)} placeholder={["日期从", "到"]} />
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 40 }}>
          <Spin />
        </div>
      ) : items.length === 0 ? (
        <div className="panel">
          <Empty description="暂无单据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </div>
      ) : isDesktop ? (
        <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
          <Table
            rowKey={(d) => String(d.id)}
            dataSource={items}
            size="middle"
            pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
            onRow={(d) => ({ onClick: () => navigate(`/documents/${d.id}`), style: { cursor: "pointer" } })}
            columns={[
              { title: "单据编号", dataIndex: "docNo", className: "num", width: 170 },
              { title: "类型", width: 130, render: (_, d) => typeLabels.get(d.docType) ?? d.docType },
              { title: "日期", width: 110, render: (_, d) => dayjs(d.date).format("YYYY-MM-DD") },
              { title: "仓库", render: (_, d) => d.warehouse?.name },
              {
                title: "往来单位",
                render: (_, d) => d.supplier?.name ?? d.customer?.name ?? "—",
              },
              { title: "车次", dataIndex: "vehicleNo", render: (v) => v ?? "—" },
              {
                title: "物料",
                render: (_, d) =>
                  d.lines[0]
                    ? `${d.lines[0].material?.code ?? ""} ${d.lines[0].material?.name ?? ""}${d.lines.length > 1 ? ` 等${d.lines.length}项` : ""}`
                    : "—",
              },
              {
                title: "数量",
                align: "right" as const,
                className: "num",
                render: (_, d) => {
                  const units = [...new Set(d.lines.map((l) => l.unit))];
                  const qty = d.lines.reduce((s, l) => s + Number(l.quantity), 0);
                  return `${qty.toLocaleString()} ${units.join("/")}`;
                },
              },
              { title: "状态", width: 90, render: (_, d) => statusTag(d.status) },
            ]}
          />
        </div>
      ) : (
        <>
          <div style={{ color: "#8c8c8c", fontSize: 13, marginBottom: 8 }}>共 {total} 条</div>
          {items.map((doc) => {
            const qty = doc.lines.reduce((s, l) => s + Number(l.quantity), 0);
            const units = [...new Set(doc.lines.map((l) => l.unit))];
            return (
              <div key={String(doc.id)} className="doc-card" onClick={() => navigate(`/documents/${doc.id}`)}>
                <div className="doc-card-top">
                  <span className="doc-no">{doc.docNo}</span>
                  {statusTag(doc.status)}
                </div>
                <div className="doc-meta">
                  <span style={{ color: "#0958d9" }}>{typeLabels.get(doc.docType) ?? doc.docType}</span>
                  <span>{dayjs(doc.date).format("YYYY-MM-DD")}</span>
                  <span>{doc.warehouse?.name}</span>
                  {doc.supplier && <span>{doc.supplier.name}</span>}
                  {doc.customer && <span>{doc.customer.name}</span>}
                  {doc.vehicleNo && <span>车次 {doc.vehicleNo}</span>}
                </div>
                <div className="doc-qty">
                  {qty.toLocaleString()} {units.join("/")}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
