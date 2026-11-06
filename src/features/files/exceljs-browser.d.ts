// 显式使用生产浏览器入口：Node 入口的 JSZip 分块编码会损坏跨 16384 字符边界的代理对。
declare module "exceljs/dist/exceljs.min.js" {
  const ExcelJS: typeof import("exceljs");
  export default ExcelJS;
}
