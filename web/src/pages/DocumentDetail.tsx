import { useCallback, useEffect, useState } from "react";
import { Button, Descriptions, message, Popconfirm, Spin, Table, Tag } from "antd";
import { ArrowLeftOutlined, CheckOutlined, DeleteOutlined, EditOutlined, UndoOutlined } from "@ant-design/icons";
import { useNavigate, useParams } from "react-router-dom";
import dayjs from "dayjs";
import { api, Doc } from "../api";
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

  const typeLabel = meta.docTypes.find((t) => t.key === doc.docType)?.label ?? doc.docType;
  const approved = doc.status === "APPROVED";
  const canWrite = meta.capabilities?.canWriteDocs !== false;

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
              <Button type="primary" icon={<CheckOutlined />} loading={busy} onClick={() => action("approve", "审核成功")}>
                审核
              </Button>
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
        scroll={{ x: 700 }}
        columns={[
          { title: "物料编码", render: (_, l) => l.material?.code },
          { title: "品名", render: (_, l) => l.material?.name },
          {
            title: "检索码",
            render: (_, l) =>
              l.retrievalCode ? (
                <a onClick={(e) => { e.stopPropagation(); navigate(`/trace?q=${encodeURIComponent(l.retrievalCode!)}`); }}>
                  {l.retrievalCode}
                </a>
              ) : ("—"),
          },
          { title: "产地", dataIndex: "origin" },
          {
            title: "数量",
            align: "right" as const,
            render: (_, l) => `${Number(l.quantity).toLocaleString()} ${l.unit}`,
          },
          { title: "包装物", dataIndex: "packaging" },
        ]}
      />
    </div>
  );
}
