import { useState } from "react";
import { Button, Divider, Input, message, Select, Space } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { api, Id } from "../api";

interface Option {
  id: Id;
  name: string;
}

/**
 * 可编辑下拉框: 下拉列表底部带"添加"输入行, 新选项实时保存到服务器并立即可选.
 * endpoint: POST /masters/<endpoint> { name, code? }
 */
export default function EditableSelect({
  value,
  onChange,
  options,
  endpoint,
  placeholder,
  withCode,
  onAdded,
}: {
  value?: Id;
  onChange?: (v: Id) => void;
  options: Option[];
  endpoint: string; // e.g. "suppliers" | "customers" | "origins" | "packagings"
  placeholder?: string;
  withCode?: boolean; // 云端模式下供应商/客户可附带编码
  onAdded?: (opt: Option) => void;
}) {
  const [items, setItems] = useState<Option[]>(options);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [adding, setAdding] = useState(false);

  async function addItem() {
    const n = name.trim();
    if (!n) return;
    setAdding(true);
    try {
      const opt = await api<Option>(`/masters/${endpoint}`, {
        method: "POST",
        body: withCode && code.trim() ? { name: n, code: code.trim() } : { name: n },
      });
      if (!items.some((i) => i.id === opt.id)) setItems([...items, opt]);
      setName("");
      setCode("");
      onChange?.(opt.id);
      onAdded?.(opt);
      message.success(`已添加: ${opt.name}`);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setAdding(false);
    }
  }

  return (
    <Select
      showSearch
      optionFilterProp="label"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      options={items.map((i) => ({ value: i.id, label: i.name }))}
      dropdownRender={(menu) => (
        <>
          {menu}
          <Divider style={{ margin: "6px 0" }} />
          <Space.Compact style={{ width: "100%", padding: "0 6px 6px" }}>
            <Input
              size="small"
              placeholder="新增名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              onPressEnter={addItem}
            />
            {withCode && (
              <Input
                size="small"
                style={{ maxWidth: 90 }}
                placeholder="编码(选填)"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                onPressEnter={addItem}
              />
            )}
            <Button size="small" type="primary" icon={<PlusOutlined />} loading={adding} onClick={addItem} />
          </Space.Compact>
        </>
      )}
    />
  );
}
