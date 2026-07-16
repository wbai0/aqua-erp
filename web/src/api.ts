// 简单 API 客户端: token 存 localStorage, 401 时跳转登录
export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  roles: string[];
}

export interface HealthInfo {
  ok: boolean;
  mode: "cloud" | "local";
  database: {
    isLocal: boolean;
    label: string;
  };
}

export function getToken(): string | null {
  return localStorage.getItem("token");
}

export function getUser(): AuthUser | null {
  const s = localStorage.getItem("user");
  return s ? JSON.parse(s) : null;
}

export function setAuth(token: string, user: AuthUser) {
  localStorage.setItem("token", token);
  localStorage.setItem("user", JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
}

export async function api<T = any>(
  path: string,
  options: { method?: string; body?: unknown; query?: Record<string, string | number | boolean | undefined> } = {}
): Promise<T> {
  let url = `/api${path}`;
  if (options.query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined && v !== "") params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }
  const res = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401) {
    clearAuth();
    if (!location.pathname.startsWith("/login")) location.href = "/login";
    throw new Error("登录已过期");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `请求失败 (${res.status})`);
  return data as T;
}

// ---------- 类型 ----------
export type Id = number | string;

export interface Meta {
  capabilities?: { canWriteDocs: boolean };
  warehouses: { id: Id; code: string; name: string }[];
  suppliers: { id: Id; name: string }[];
  customers: { id: Id; name: string }[];
  materials: { id: Id; code: string; name: string; category: string; categoryName?: string; unit: string; unitId?: string; packaging?: string | null }[];
  docTypes: {
    key: string;
    label: string;
    direction: number;
    group: "in" | "out" | "stocktake";
    needsSupplier?: boolean;
    needsCustomer?: boolean;
  }[];
  origins?: { id: Id; name: string }[];
  packagings?: { id: Id; name: string }[];
  units?: { id: Id; name: string }[];
}

export interface DocLine {
  id?: Id;
  materialId: Id;
  material?: Meta["materials"][number];
  batchNo?: string | null;
  retrievalCode?: string | null;
  origin?: string | null;
  quantity: number | string;
  unit: string;
  unitId?: string;
  spec?: string | null;
  packQuantity?: number | string | null;
  packUnit?: string | null;
  tech?: string | null;
  weight?: number | string | null;
  weightUnit?: string | null;
  packaging?: string | null;
  note?: string | null;
}

export interface Doc {
  id: Id;
  docNo: string;
  docType: string;
  date: string;
  status: "DRAFT" | "APPROVED";
  warehouseId?: Id;
  warehouse?: { name: string };
  supplierId?: Id | null;
  supplier?: { name: string } | null;
  customerId?: Id | null;
  customer?: { name: string } | null;
  vehicleNo?: string | null;
  remark?: string | null;
  createdBy?: { displayName: string };
  approvedBy?: { displayName: string } | null;
  lines: DocLine[];
}

export interface StockRow {
  warehouseId: Id;
  warehouseName: string;
  materialId: Id;
  materialCode: string;
  materialName: string;
  category: string;
  categoryName?: string;
  shortName?: string;
  unit: string;
  supplier?: string | null;
  supplierName?: string;
  origin: string | null;
  moisture?: string;
  packSpec?: number | null;
  packUnit?: string;
  packQty?: number | null;
  batchNo: string | null;
  retrievalCode: string | null;
  inQuantity?: number;
  outQuantity?: number;
  quantity: number;
}

export const CATEGORY_LABELS: Record<string, string> = {
  RAW: "毛料",
  SEMI: "半成品",
  FINISHED: "成品",
};
