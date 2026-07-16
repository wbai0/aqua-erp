// AG Grid 全局设置：注册社区模块 + 企业风主题 + 默认列行为。
// 用新版 Theming API（无需引入 CSS 文件）。
import { ModuleRegistry, AllCommunityModule, themeQuartz, type ColDef } from "ag-grid-community";

ModuleRegistry.registerModules([AllCommunityModule]);

// 和全站统一的企业蓝 / 中性灰
export const gridTheme = themeQuartz.withParams({
  accentColor: "#1868db",
  headerBackgroundColor: "#fafbfc",
  headerTextColor: "#4e5969",
  borderColor: "#edeef1",
  rowHoverColor: "#eef4ff",
  oddRowBackgroundColor: "#fcfcfd",
  fontFamily: "inherit",
  fontSize: 13,
  headerFontWeight: 600,
});

// 默认：可排序、可拖拽列宽、可换列序。筛选交给上方 antd 多选(服务端查询)，故关闭表内筛选。
export const gridDefaultColDef: ColDef = {
  sortable: true,
  filter: false,
  resizable: true,
  minWidth: 70,
};
