import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, DatePicker, Form, Input, InputNumber, message, Modal, Select, Space, Spin } from "antd";
import { ArrowLeftOutlined, DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { useBlocker, useNavigate, useParams, useSearchParams } from "react-router-dom";
import dayjs, { Dayjs } from "dayjs";
import { api, Doc, Id, Meta } from "../api";
import { useMeta } from "../App";
import EditableSelect from "../components/EditableSelect";

interface LineForm {
  materialId?: Id;
  batchNo?: string;
  retrievalCode?: string;
  origin?: string;
  quantity?: number;
  unit?: string;
  packaging?: string;
}

interface DocumentFormValues {
  date?: Dayjs;
  warehouseId?: Id;
  supplierId?: Id;
  customerId?: Id;
  vehicleNo?: string;
  remark?: string;
  lines?: LineForm[];
}

interface NewMaterialValues {
  code: string;
  name: string;
  category: string;
  unit: string;
}

interface StoredDraft {
  version: 1;
  savedAt: string;
  docType: string;
  values: Omit<DocumentFormValues, "date"> & { date?: string };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败";
}

function readDraft(key: string): StoredDraft | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Partial<StoredDraft>;
    if (candidate.version !== 1 || typeof candidate.savedAt !== "string" || typeof candidate.docType !== "string") return null;
    if (!candidate.values || typeof candidate.values !== "object") return null;
    return candidate as StoredDraft;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

export default function DocumentForm() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const copyFrom = searchParams.get("copyFrom") || undefined;
  const navigate = useNavigate();
  const meta = useMeta();
  const [form] = Form.useForm<DocumentFormValues>();
  const [matForm] = Form.useForm<NewMaterialValues>();
  const [saving, setSaving] = useState(false);
  const [initializing, setInitializing] = useState(Boolean(id || copyFrom));
  const [docType, setDocType] = useState(searchParams.get("type") ?? "PURCHASE_IN");
  const [materialList, setMaterialList] = useState(meta.materials);
  const [matModalLine, setMatModalLine] = useState<number | null>(null);
  const [matSaving, setMatSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string>();
  const initializedRef = useRef(false);
  const skipBlockRef = useRef(false);

  const draftKey = useMemo(() => {
    if (id) return `cide-erp:document-draft:edit:${id}`;
    if (copyFrom) return `cide-erp:document-draft:copy:${copyFrom}`;
    return `cide-erp:document-draft:new:${docType}`;
  }, [copyFrom, docType, id]);

  const blocker = useBlocker(() => dirty && !skipBlockRef.current);

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    Modal.confirm({
      title: "有尚未保存的修改",
      content: "离开后仍可从自动暂存中恢复。确定离开当前页面吗？",
      okText: "离开页面",
      cancelText: "继续填写",
      onOk: () => blocker.proceed(),
      onCancel: () => blocker.reset(),
    });
  }, [blocker]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  function unitValue(unitId: string | undefined, unitName: string): string {
    return unitId ?? String(meta.units?.find((unit) => unit.name === unitName)?.id ?? unitName);
  }

  function valuesFromDocument(doc: Doc, copying: boolean): DocumentFormValues {
    return {
      date: copying ? dayjs() : dayjs(doc.date),
      warehouseId: doc.warehouseId ?? meta.warehouses.find((warehouse) => warehouse.name === doc.warehouse?.name)?.id,
      supplierId: doc.supplierId ?? meta.suppliers.find((supplier) => supplier.name === doc.supplier?.name)?.id,
      customerId: doc.customerId ?? meta.customers.find((customer) => customer.name === doc.customer?.name)?.id,
      vehicleNo: copying ? undefined : doc.vehicleNo ?? undefined,
      remark: doc.remark ?? undefined,
      lines: doc.lines.map((line) => ({
        materialId: line.materialId,
        batchNo: copying ? undefined : line.batchNo ?? undefined,
        retrievalCode: copying ? undefined : line.retrievalCode ?? undefined,
        origin: line.origin ?? undefined,
        quantity: Number(line.quantity),
        unit: unitValue(line.unitId, line.unit),
        packaging: line.packaging ?? undefined,
      })),
    };
  }

  function persistDraft(values: DocumentFormValues, type = docType, key = draftKey) {
    const savedAt = new Date().toISOString();
    const stored: StoredDraft = {
      version: 1,
      savedAt,
      docType: type,
      values: {
        ...values,
        date: values.date?.toISOString(),
      },
    };
    localStorage.setItem(key, JSON.stringify(stored));
    setLastSavedAt(savedAt);
  }

  function restoreDraft(stored: StoredDraft) {
    setDocType(stored.docType);
    form.setFieldsValue({
      ...stored.values,
      date: stored.values.date ? dayjs(stored.values.date) : dayjs(),
    });
    setDirty(true);
    setLastSavedAt(stored.savedAt);
    message.success("已恢复自动暂存内容");
  }

  function offerDraftRestore(key: string) {
    const stored = readDraft(key);
    if (!stored) return;
    Modal.confirm({
      title: "发现未完成的单据",
      content: `自动暂存于 ${dayjs(stored.savedAt).format("MM-DD HH:mm")}，是否继续填写？`,
      okText: "恢复草稿",
      cancelText: "放弃草稿",
      onOk: () => restoreDraft(stored),
      onCancel: () => localStorage.removeItem(key),
    });
  }

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const initialize = async () => {
      try {
        if (id) {
          const doc = await api<Doc>(`/documents/${id}`);
          setDocType(doc.docType);
          form.setFieldsValue(valuesFromDocument(doc, false));
          offerDraftRestore(`cide-erp:document-draft:edit:${id}`);
        } else if (copyFrom) {
          const doc = await api<Doc>(`/documents/${copyFrom}`);
          const values = valuesFromDocument(doc, true);
          const key = `cide-erp:document-draft:copy:${copyFrom}`;
          setDocType(doc.docType);
          form.setFieldsValue(values);
          const stored = readDraft(key);
          if (stored) offerDraftRestore(key);
          else {
            setDirty(true);
            persistDraft(values, doc.docType, key);
            message.info("已复制基础信息，请填写新车次和检索码并核对数量");
          }
        } else {
          offerDraftRestore(`cide-erp:document-draft:new:${docType}`);
        }
      } catch (error: unknown) {
        message.error(errorMessage(error));
      } finally {
        setInitializing(false);
      }
    };

    void initialize();
  }, [copyFrom, docType, form, id]);

  const typeInfo = meta.docTypes.find((type) => type.key === docType);
  const needsSupplier = typeInfo?.needsSupplier ?? false;
  const needsCustomer = typeInfo?.needsCustomer ?? false;
  const typeLabel = typeInfo?.label ?? docType;
  const watchedLines = Form.useWatch("lines", form) ?? [];

  const totals = useMemo(() => {
    const byUnit = new Map<string, number>();
    let completedLines = 0;
    for (const line of watchedLines) {
      if (!line?.materialId && !line?.quantity) continue;
      completedLines += 1;
      const unitName = meta.units?.find((unit) => String(unit.id) === String(line.unit))?.name ?? line.unit ?? "未选单位";
      byUnit.set(unitName, (byUnit.get(unitName) ?? 0) + Number(line.quantity ?? 0));
    }
    return { completedLines, byUnit };
  }, [meta.units, watchedLines]);

  const materialOptions = useMemo(
    () => materialList.map((material) => ({ value: material.id, label: `${material.code} ${material.name} (${material.unit})` })),
    [materialList]
  );

  const categoryOptions = useMemo(
    () => [...new Set(materialList.map((material) => material.category))].map((category) => ({ value: category, label: category })),
    [materialList]
  );

  async function addMaterial(values: NewMaterialValues) {
    setMatSaving(true);
    try {
      const material = await api<Meta["materials"][number]>("/masters/materials", { method: "POST", body: values });
      setMaterialList((list) => (list.some((item) => item.id === material.id) ? list : [...list, material]));
      if (matModalLine !== null) {
        const lines = form.getFieldValue("lines") ?? [];
        lines[matModalLine] = { ...lines[matModalLine], materialId: material.id, unit: material.unitId ?? material.unit };
        form.setFieldsValue({ lines });
        setDirty(true);
        persistDraft(form.getFieldsValue(true));
      }
      message.success(`已添加物料: ${material.code}`);
      setMatModalLine(null);
      matForm.resetFields();
    } catch (error: unknown) {
      message.error(errorMessage(error));
    } finally {
      setMatSaving(false);
    }
  }

  async function onFinish(values: DocumentFormValues) {
    if (!values.date || !values.warehouseId || !values.lines?.length) return;
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
        lines: values.lines.map((line) => ({
          materialId: line.materialId!,
          batchNo: line.batchNo || values.vehicleNo || null,
          retrievalCode: line.retrievalCode || null,
          origin: line.origin || null,
          quantity: line.quantity!,
          unit: line.unit!,
          packaging: line.packaging || null,
        })),
      };
      skipBlockRef.current = true;
      if (id) {
        await api(`/documents/${id}`, { method: "PUT", body });
        localStorage.removeItem(draftKey);
        setDirty(false);
        message.success("已保存");
        navigate(`/documents/${id}`, { replace: true });
      } else {
        const created = await api<Pick<Doc, "id" | "docNo">>("/documents", { method: "POST", body });
        localStorage.removeItem(draftKey);
        setDirty(false);
        message.success(`已创建 ${created.docNo}`);
        navigate(`/documents/${created.id}`, { replace: true });
      }
    } catch (error: unknown) {
      skipBlockRef.current = false;
      message.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  function onMaterialChange(index: number, materialId: Id) {
    const material = materialList.find((item) => item.id === materialId);
    if (!material) return;
    const lines = form.getFieldValue("lines") ?? [];
    lines[index] = { ...lines[index], unit: material.unitId ?? material.unit, packaging: material.packaging ?? undefined };
    form.setFieldsValue({ lines });
    setDirty(true);
    persistDraft(form.getFieldsValue(true));
  }

  function onValuesChange(_changed: Partial<DocumentFormValues>, values: DocumentFormValues) {
    setDirty(true);
    persistDraft(values);
  }

  if (initializing) {
    return (
      <div style={{ textAlign: "center", padding: 60 }}>
        <Spin />
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>
          返回
        </Button>
        <h1 className="page-title">{id ? "修改" : copyFrom ? "复制" : "新建"}{typeLabel}单</h1>
        <span />
      </div>

      <Form<DocumentFormValues>
        form={form}
        layout="vertical"
        onFinish={onFinish}
        onValuesChange={onValuesChange}
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
              <Select options={meta.warehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name }))} />
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
                        onChange={(value) => onMaterialChange(index, value)}
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
                      <Select options={(meta.units ?? []).map((unit) => ({ value: String(unit.id), label: unit.name }))} />
                    </Form.Item>
                    <Form.Item name={[field.name, "retrievalCode"]} label="检索码" style={{ marginBottom: 8 }}>
                      <Input placeholder="如 WXF.XH.25.14" />
                    </Form.Item>
                    <Form.Item name={[field.name, "origin"]} label="产地" style={{ marginBottom: 8 }}>
                      <EditableSelect
                        endpoint="origins"
                        placeholder="选择或新增产地"
                        options={(meta.origins ?? []).map((origin) => ({ id: origin.name, name: origin.name }))}
                      />
                    </Form.Item>
                    <Form.Item name={[field.name, "packaging"]} label="包装物" style={{ marginBottom: 8 }}>
                      <EditableSelect
                        endpoint="packagings"
                        placeholder="选择或新增包装物"
                        options={(meta.packagings ?? []).map((packaging) => ({ id: packaging.name, name: packaging.name }))}
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

        <div className="form-submit-bar">
          <div className="form-live-total">
            <b>{totals.completedLines} 项明细</b>
            <span>
              {[...totals.byUnit.entries()].map(([unit, quantity]) => `${quantity.toLocaleString()} ${unit}`).join(" / ") || "尚未填写数量"}
            </span>
            <small>{lastSavedAt ? `已自动暂存 ${dayjs(lastSavedAt).format("HH:mm:ss")}` : "修改后将自动暂存"}</small>
          </div>
          <Space>
            <Button onClick={() => navigate(-1)}>取消</Button>
            <Button type="primary" htmlType="submit" loading={saving}>
              保存
            </Button>
          </Space>
        </div>
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
        <Form<NewMaterialValues> form={matForm} layout="vertical" onFinish={addMaterial}>
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
            <Select options={(meta.units ?? []).map((unit) => ({ value: String(unit.id), label: unit.name }))} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
