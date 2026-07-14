import { useEffect, useMemo, useState } from "react";
import { Button, Card, DatePicker, Form, Input, InputNumber, message, Modal, Select, Space } from "antd";
import { ArrowLeftOutlined, DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import dayjs from "dayjs";
import { api, Doc } from "../api";
import { useMeta } from "../App";
import EditableSelect from "../components/EditableSelect";

interface LineForm {
  materialId?: number | string;
  batchNo?: string;
  retrievalCode?: string;
  origin?: string;
  quantity?: number;
  unit?: string;
  packaging?: string;
}

export default function DocumentForm() {
  const { id } = useParams(); // 有 id 表示编辑
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const meta = useMeta();
  const [form] = Form.useForm();
  const [matForm] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [docType, setDocType] = useState(searchParams.get("type") ?? "PURCHASE_IN");
  const [materialList, setMaterialList] = useState(meta.materials);
  const [matModalLine, setMatModalLine] = useState<number | null>(null); // 打开新增物料弹窗的明细行
  const [matSaving, setMatSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    api<Doc>(`/documents/${id}`).then((doc) => {
      setDocType(doc.docType);
      form.setFieldsValue({
        date: dayjs(doc.date),
        warehouseId: doc.warehouseId,
        supplierId: doc.supplierId ?? undefined,
        customerId: doc.customerId ?? undefined,
        vehicleNo: doc.vehicleNo ?? undefined,
        remark: doc.remark ?? undefined,
        lines: doc.lines.map((l) => ({
          materialId: l.materialId,
          batchNo: l.batchNo ?? undefined,
          retrievalCode: l.retrievalCode ?? undefined,
          origin: l.origin ?? undefined,
          quantity: Number(l.quantity),
          unit: (l as any).unitId ?? l.unit,
          packaging: l.packaging ?? undefined,
        })),
      });
    });
  }, [id, form]);

  const typeInfo = meta.docTypes.find((t) => t.key === docType);
  const needsSupplier = typeInfo?.needsSupplier ?? false;
  const needsCustomer = typeInfo?.needsCustomer ?? false;
  const typeLabel = typeInfo?.label ?? docType;

  const materialOptions = useMemo(
    () => materialList.map((m) => ({ value: m.id, label: `${m.code} ${m.name} (${m.unit})` })),
    [materialList]
  );

  const categoryOptions = useMemo(
    () => [...new Set(materialList.map((m) => m.category))].map((c) => ({ value: c, label: c })),
    [materialList]
  );

  async function addMaterial(values: any) {
    setMatSaving(true);
    try {
      const m = await api<any>("/masters/materials", { method: "POST", body: values });
      setMaterialList((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]));
      if (matModalLine !== null) {
        const lines = form.getFieldValue("lines") ?? [];
        lines[matModalLine] = { ...lines[matModalLine], materialId: m.id, unit: m.unitId ?? m.unit };
        form.setFieldsValue({ lines });
      }
      message.success(`已添加物料: ${m.code}`);
      setMatModalLine(null);
      matForm.resetFields();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setMatSaving(false);
    }
  }

  async function onFinish(values: any) {
    setSaving(true);
    try {
      const body = {
        docType,
        date: values.date.format("YYYY-MM-DD"),
        warehouseId: values.warehouseId,
        supplierId: values.supplierId ?? null,
        customerId: values.customerId ?? null,
        vehicleNo: values.vehicleNo || null,
        remark: values.remark || null,
        lines: (values.lines as LineForm[]).map((l) => ({
          materialId: l.materialId!,
          batchNo: l.batchNo || values.vehicleNo || null,
          retrievalCode: l.retrievalCode || null,
          origin: l.origin || null,
          quantity: l.quantity!,
          unit: l.unit!,
          packaging: l.packaging || null,
        })),
      };
      if (id) {
        await api(`/documents/${id}`, { method: "PUT", body });
        message.success("已保存");
        navigate(`/documents/${id}`, { replace: true });
      } else {
        const doc = await api<Doc>("/documents", { method: "POST", body });
        message.success(`已创建 ${doc.docNo}`);
        navigate(`/documents/${doc.id}`, { replace: true });
      }
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  function onMaterialChange(index: number, materialId: number | string) {
    const m = materialList.find((x) => x.id === materialId);
    if (!m) return;
    const lines = form.getFieldValue("lines") ?? [];
    lines[index] = { ...lines[index], unit: m.unitId ?? m.unit, packaging: m.packaging };
    form.setFieldsValue({ lines });
  }

  return (
    <div>
      <div className="page-header">
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>
          返回
        </Button>
        <h1 className="page-title">{id ? "修改" : "新建"}{typeLabel}单</h1>
        <span />
      </div>

      <Form
        form={form}
        layout="vertical"
        onFinish={onFinish}
        initialValues={{
          date: dayjs(),
          warehouseId: meta.warehouses[0]?.id,
          lines: [{}],
        }}
      >
        <Card size="small" title="单据信息" style={{ marginBottom: 12 }}>
          <div className="filter-bar">
            <Form.Item name="date" label="日期" rules={[{ required: true }]} style={{ marginBottom: 8 }}>
              <DatePicker style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="warehouseId" label="仓库" rules={[{ required: true }]} style={{ marginBottom: 8 }}>
              <Select options={meta.warehouses.map((w) => ({ value: w.id, label: w.name }))} />
            </Form.Item>
            {needsSupplier && (
              <Form.Item name="supplierId" label="供应商" rules={[{ required: true, message: "请选择供应商" }]} style={{ marginBottom: 8 }}>
                <EditableSelect endpoint="suppliers" withCode placeholder="选择或新增供应商" options={meta.suppliers} />
              </Form.Item>
            )}
            {needsCustomer && (
              <Form.Item name="customerId" label="客户" rules={[{ required: true, message: "请选择客户" }]} style={{ marginBottom: 8 }}>
                <EditableSelect endpoint="customers" withCode placeholder="选择或新增客户" options={meta.customers} />
              </Form.Item>
            )}
            <Form.Item name="vehicleNo" label="车次" style={{ marginBottom: 8 }}>
              <Input placeholder="如 25-14" />
            </Form.Item>
          </div>
          <Form.Item name="remark" label="备注" style={{ marginBottom: 0 }}>
            <Input.TextArea rows={1} />
          </Form.Item>
        </Card>

        <Form.List name="lines">
          {(fields, { add, remove }) => (
            <>
              {fields.map((field, index) => (
                <Card
                  key={field.key}
                  size="small"
                  title={`明细 ${index + 1}`}
                  style={{ marginBottom: 12 }}
                  extra={
                    fields.length > 1 && (
                      <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                    )
                  }
                >
                  <Form.Item
                    label={
                      <span>
                        物料{" "}
                        <a style={{ fontWeight: 400 }} onClick={() => setMatModalLine(index)}>
                          + 新增物料
                        </a>
                      </span>
                    }
                    style={{ marginBottom: 8 }}
                  >
                    <Form.Item name={[field.name, "materialId"]} rules={[{ required: true, message: "请选择物料" }]} noStyle>
                      <Select
                        showSearch
                        optionFilterProp="label"
                        options={materialOptions}
                        onChange={(v) => onMaterialChange(index, v)}
                        placeholder="选择物料"
                      />
                    </Form.Item>
                  </Form.Item>
                  <div className="filter-bar">
                    <Form.Item
                      name={[field.name, "quantity"]}
                      label="数量"
                      rules={[{ required: true, message: "请输入数量" }]}
                      style={{ marginBottom: 8 }}
                    >
                      <InputNumber style={{ width: "100%" }} min={0.001} inputMode="decimal" />
                    </Form.Item>
                    <Form.Item name={[field.name, "unit"]} label="单位" rules={[{ required: true }]} style={{ marginBottom: 8 }}>
                      <Select
                        options={(meta.units ?? []).map((u) => ({ value: String(u.id), label: u.name }))}
                      />
                    </Form.Item>
                    <Form.Item name={[field.name, "retrievalCode"]} label="检索码" style={{ marginBottom: 8 }}>
                      <Input placeholder="如 WXF.XH.25.14" />
                    </Form.Item>
                    <Form.Item name={[field.name, "origin"]} label="产地" style={{ marginBottom: 8 }}>
                      <EditableSelect
                        endpoint="origins"
                        placeholder="选择或新增产地"
                        options={(meta.origins ?? []).map((o) => ({ id: o.name, name: o.name }))}
                      />
                    </Form.Item>
                    <Form.Item name={[field.name, "packaging"]} label="包装物" style={{ marginBottom: 8 }}>
                      <EditableSelect
                        endpoint="packagings"
                        placeholder="选择或新增包装物"
                        options={(meta.packagings ?? []).map((p) => ({ id: p.name, name: p.name }))}
                      />
                    </Form.Item>
                  </div>
                </Card>
              ))}
              <Button block icon={<PlusOutlined />} onClick={() => add({})} style={{ marginBottom: 12 }}>
                添加明细行
              </Button>
            </>
          )}
        </Form.List>

        <Space style={{ width: "100%", justifyContent: "flex-end" }}>
          <Button onClick={() => navigate(-1)}>取消</Button>
          <Button type="primary" htmlType="submit" loading={saving}>
            保存
          </Button>
        </Space>
      </Form>

      <Modal
        title="新增物料"
        open={matModalLine !== null}
        onCancel={() => setMatModalLine(null)}
        onOk={() => matForm.submit()}
        confirmLoading={matSaving}
        okText="保存"
        cancelText="取消"
      >
        <Form form={matForm} layout="vertical" onFinish={addMaterial}>
          <Form.Item name="code" label="物料编码" rules={[{ required: true, message: "请输入编码" }]}>
            <Input placeholder="如 WYL.WXF.005" />
          </Form.Item>
          <Form.Item name="name" label="品名" rules={[{ required: true, message: "请输入品名" }]}>
            <Input placeholder="如 毛料" />
          </Form.Item>
          <Form.Item name="category" label="类别" rules={[{ required: true, message: "请选择类别" }]}>
            <Select options={categoryOptions} placeholder="如 毛料 / 半成品 / 成品" />
          </Form.Item>
          <Form.Item name="unit" label="计量单位" rules={[{ required: true, message: "请选择单位" }]}>
            <Select options={(meta.units ?? []).map((u) => ({ value: String(u.id), label: u.name }))} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
