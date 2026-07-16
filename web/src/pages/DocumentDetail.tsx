import { useCallback, useEffect, useState } from "react";
import { Button, Descriptions, message, Popconfirm, Spin, Table, Tag } from "antd";
import { ArrowLeftOutlined, CheckOutlined, CopyOutlined, DeleteOutlined, EditOutlined, UndoOutlined } from "@ant-design/icons";
import { useNavigate, useParams } from "react-router-dom";
import dayjs from "dayjs";
import { api, Doc, DocLine } from "../api";
import { useMeta } from "../App";

export default function DocumentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const meta = useMeta();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const d = await api<Doc>(`/documents/${id}`);
    setDoc(d);
  }, [id]);

  useEffect(() => {
    load().catch((e) => message.error(e.message));
  }, [load]);

  if (!doc)
    return (
      <div style={{ textAlign: "center", padding: 60 }}>
        <Spin />
      </div>
    );

  const typeInfo = meta.docTypes.find((t) => t.key === doc.docType);
  const typeLabel = typeInfo?.label ?? doc.docType;
  const approved = doc.status === "APPROVED";
  const canWrite = meta.capabilities?.canWriteDocs !== false;
  const totals = new Map<string, number>();
  for (const line of doc.lines) totals.set(line.unit, (totals.get(line.unit) ?? 0) + Number(line.quantity));
  const totalText = [...totals.entries()].map(([unit, quantity]) => `${quantity.toLocaleString()} ${unit}`).join(" / ");
  const auditEffect = (typeInfo?.direction ?? 0) >= 0 ? "正式计入库存" : "正式扣减库存";
  const lines = doc.lines;
  const hasAny = (get: (l: DocLine) => unknown) =>
    lines.some((l) => { const v = get(l); return v != null && v !== ""; });

  async function action(path: string, ok: string) {
    setBusy(true);
    try {
      await api(`/documents/${id}/${path}`, { method: "POST" });
      message.success(ok);
      await load();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api(`/documents/${id}`, { method: "DELETE" });
      message.success("已删除");
      navigate(-1);
    } catch (e: any) {
      message.error(e.message);
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>
          返回
        </Button>
        <div style={{ display: "flex", gap: 8 }}>
          {canWrite && (
            <Button icon={<CopyOutlined />} onClick={() => navigate(`/documents/new?copyFrom=${encodeURIComponent(String(id))}`)}>
              复制为新单
            </Button>
          )}
          {canWrite && !approved && (
            <>
              <Button icon={<EditOutlined />} onClick={() => navigate(`/documents/${id}/edit`)}>
                修改
              </Button>
              <Popconfirm title="确定删除该单据?" onConfirm={remove}>
                <Button danger icon={<DeleteOutlined />} loading={busy}>
                  删除
                </Button>
              </Popconfirm>
              <Popconfirm
                title={`确认审核 ${doc.docNo}？`}
                description={
                  <div className="audit-summary">
                    <div>{typeLabel} · {doc.warehouse?.name}</div>
                    <div>{doc.lines.length} 项明细 · {totalText || "未填写数量"}</div>
                    <b>审核后将{auditEffect}</b>
                  </div>
                }
                okText="确认审核"
                cancelText="再检查一下"
                onConfirm={() => action("approve", "审核成功")}
              >
                <Button type="primary" icon={<CheckOutlined />} loading={busy}>
                  审核
                </Button>
              </Popconfirm>
            </>
          )}
          {canWrite && approved && (
            <Popconfirm title="确定取消审核?" onConfirm={() => action("unapprove", "已取消审核")}>
              <Button icon={<UndoOutlined />} loading={busy}>
                取消审核
              </Button>
            </Popconfirm>
          )}
        </div>
      </div>

      <Descriptions
        bordered
        size="small"
        column={{ xs: 1, sm: 2 }}
        title={
          <span>
            {doc.docNo}{" "}
            <Tag color={approved ? "green" : "orange"}>{approved ? "已审核" : "未审核"}</Tag>
          </span>
        }
      >
        <Descriptions.Item label="单据类型">{typeLabel}</Descriptions.Item>
        <Descriptions.Item label="日期">{dayjs(doc.date).format("YYYY-MM-DD")}</Descriptions.Item>
        <Descriptions.Item label="仓库">{doc.warehouse?.name}</Descriptions.Item>
        {doc.supplier && <Descriptions.Item label="供应商">{doc.supplier.name}</Descriptions.Item>}
        {doc.customer && <Descriptions.Item label="客户">{doc.customer.name}</Descriptions.Item>}
        {doc.vehicleNo && <Descriptions.Item label="车次">{doc.vehicleNo}</Descriptions.Item>}
        <Descriptions.Item label="制单人">{doc.createdBy?.displayName}</Descriptions.Item>
        {doc.approvedBy && <Descriptions.Item label="审核人">{doc.approvedBy.displayName}</Descriptions.Item>}
        {doc.remark && <Descriptions.Item label="备注">{doc.remark}</Descriptions.Item>}
      </Descriptions>

      <h3 style={{ marginTop: 20 }}>明细</h3>
      <Table
        rowKey={(l) => String(l.id)}
        dataSource={doc.lines}
        pagination={false}
        size="small"
        scroll={{ x: 980 }}
        columns={[
          {
            title: "物料编码",
            render: (_, l) => l.material?.code ? (
              <a
                onClick={(event) => {
                  event.stopPropagation();
                  navigate(`/trace?mode=material&q=${encodeURIComponent(l.material!.code)}`);
                }}
              >
                {l.material.code}
              </a>
            ) : "—",
          },
          { title: "品名", render: (_, l) => l.material?.name },
          ...(hasAny((l) => l.spec) ? [{ title: "规格", render: (_: any, l: any) => l.spec || "—" }] : []),
          {
            title: "检索码",
            render: (_, l) =>
              l.retrievalCode ? (
                <a onClick={(e) => { e.stopPropagation(); navigate(`/trace?q=${encodeURIComponent(l.retrievalCode!)}`); }}>
                  {l.retrievalCode}
                </a>
              ) : ("—"),
          },
          ...(hasAny((l) => l.batchNo) ? [{ title: "批次号", render: (_: any, l: any) => l.batchNo || "—" }] : []),
          { title: "产地", dataIndex: "origin" },
          {
            title: "数量",
            align: "right" as const,
            render: (_, l) => `${Number(l.quantity).toLocaleString()} ${l.unit}`,
          },
          ...(hasAny((l) => l.packQuantity != null && l.packQuantity !== "")
            ? [{
                title: "件数",
                align: "right" as const,
                render: (_: any, l: any) =>
                  l.packQuantity != null && l.packQuantity !== ""
                    ? `${Number(l.packQuantity).toLocaleString()}${l.packUnit ? " " + l.packUnit : ""}`
                    : "—",
              }]
            : []),
          ...(hasAny((l) => l.tech) ? [{ title: "工艺", render: (_: any, l: any) => l.tech || "—" }] : []),
          { title: "包装物", dataIndex: "packaging", render: (v: any) => v || "—" },
          ...(hasAny((l) => l.note) ? [{ title: "备注", dataIndex: "note", render: (v: any) => v || "—" }] : []),
        ]}
      />
    </div>
  );
}
