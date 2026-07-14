// 单据类型定义与方向 (+1 入库 / -1 出库)
export const DOC_TYPES = {
  PURCHASE_IN: { label: "采购入库", prefix: "CGRK", direction: 1 },
  PRODUCTION_IN: { label: "生产入库", prefix: "SCRK", direction: 1 },
  OTHER_IN: { label: "其它入库", prefix: "QTRK", direction: 1 },
  MATERIAL_OUT: { label: "毛料出库", prefix: "MLCK", direction: -1 },
  PRODUCTION_OUT: { label: "生产出库", prefix: "SCCK", direction: -1 },
  SALES_OUT: { label: "销售出库", prefix: "XSCK", direction: -1 },
  OTHER_OUT: { label: "其它出库", prefix: "QTCK", direction: -1 },
  GAIN: { label: "盘盈", prefix: "PYRK", direction: 1 },
  LOSS: { label: "盘亏", prefix: "PKCK", direction: -1 },
} as const;

export type DocType = keyof typeof DOC_TYPES;

export function isDocType(t: string): t is DocType {
  return t in DOC_TYPES;
}

export function direction(t: string): number {
  return isDocType(t) ? DOC_TYPES[t].direction : 0;
}
