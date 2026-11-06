import ExcelJS from "exceljs/dist/exceljs.min.js";
import type { Workbook, Worksheet } from "exceljs";
import { Unzip, UnzipInflate } from "fflate";
import type { ExperimentConfig, Issue, Snapshot } from "../../domain/types";
import {
  normalizeConfig,
  scaled,
  validateConfig,
} from "../../domain/validation";
import { summarize } from "../analysis/statistics";
import template from "../../../docs/examples/experiment-valid.json";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 20 * 1024 * 1024;
const MAX_CELLS = 20_000;
const MAX_ZIP_ENTRIES = 256;
type Scalar = string | number | boolean | null;
type Location = Pick<Issue, "sheet" | "cell">;
export interface ImportResult {
  config: ExperimentConfig | null;
  issues: Issue[];
}

class ImportFailure extends Error {
  constructor(readonly issue: Issue) {
    super(issue.message);
  }
}
function fail(
  code: string,
  message: string,
  path = "",
  location: Location = {},
): never {
  throw new ImportFailure({ code, message, path, ...location });
}

function inspectZipDirectory(bytes: Uint8Array): Set<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (
    end >= Math.max(0, bytes.length - 65557) &&
    (view.getUint32(end, true) !== 0x06054b50 ||
      end + 22 + view.getUint16(end + 20, true) !== bytes.length)
  )
    end--;
  if (end < Math.max(0, bytes.length - 65557))
    fail("INVALID_CONTAINER", "ZIP 中央目录无效。");
  const entries = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const centralOffset = view.getUint32(end + 16, true);
  if (
    view.getUint16(end + 4, true) ||
    view.getUint16(end + 6, true) ||
    entries !== view.getUint16(end + 8, true) ||
    entries === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  )
    fail("UNSAFE_CONTAINER", "不接受多卷或 ZIP64 容器。");
  if (entries > MAX_ZIP_ENTRIES) fail("FILE_TOO_LARGE", "ZIP 条目过多。");
  if (centralOffset + centralSize !== end)
    fail("UNSAFE_CONTAINER", "ZIP 中央目录位置异常。");
  const names = new Set<string>();
  let position = centralOffset;
  let declaredTotal = 0;
  for (let index = 0; index < entries; index++) {
    if (position + 46 > end || view.getUint32(position, true) !== 0x02014b50)
      fail("INVALID_CONTAINER", "ZIP 中央目录条目无效。");
    const flags = view.getUint16(position + 8, true);
    const method = view.getUint16(position + 10, true);
    const compressed = view.getUint32(position + 20, true);
    const expanded = view.getUint32(position + 24, true);
    const nameLength = view.getUint16(position + 28, true);
    const extraLength = view.getUint16(position + 30, true);
    const commentLength = view.getUint16(position + 32, true);
    const local = view.getUint32(position + 42, true);
    if (
      flags & 1 ||
      ![0, 8].includes(method) ||
      compressed === 0xffffffff ||
      expanded === 0xffffffff ||
      local === 0xffffffff
    )
      fail("UNSAFE_CONTAINER", "不接受加密、ZIP64 或非常规压缩。");
    if (
      position + 46 + nameLength + extraLength + commentLength > end ||
      local + 30 > centralOffset ||
      view.getUint32(local, true) !== 0x04034b50
    )
      fail("INVALID_CONTAINER", "ZIP 条目位置无效。");
    const nameBytes = bytes.subarray(position + 46, position + 46 + nameLength);
    const name = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes);
    if (
      names.has(name) ||
      name.includes("..") ||
      name.startsWith("/") ||
      name.includes("\\") ||
      name.includes("\0")
    )
      fail("UNSAFE_CONTAINER", "ZIP 含重复或不安全路径。");
    names.add(name);
    const localNameLength = view.getUint16(local + 26, true);
    const localExtraLength = view.getUint16(local + 28, true);
    const dataEnd =
      local + 30 + localNameLength + localExtraLength + compressed;
    if (
      view.getUint16(local + 6, true) !== flags ||
      view.getUint16(local + 8, true) !== method ||
      localNameLength !== nameLength ||
      dataEnd > centralOffset ||
      nameBytes.some((byte, offset) => byte !== bytes[local + 30 + offset])
    )
      fail("UNSAFE_CONTAINER", "ZIP 本地条目与中央目录不一致。");
    declaredTotal += expanded;
    if (declaredTotal > MAX_EXPANDED_BYTES)
      fail("FILE_TOO_LARGE", "解压后内容超过 20MiB。");
    position += 46 + nameLength + extraLength + commentLength;
  }
  if (position !== end) fail("INVALID_CONTAINER", "ZIP 中央目录长度无效。");
  return names;
}

function xmlAttributes(tag: string): Record<string, string> {
  return Object.fromEntries(
    [...tag.matchAll(/([\w:.-]+)\s*=\s*(["'])(.*?)\2/g)].map((match) => [
      match[1],
      match[3].replace(
        /&(?:amp|quot|apos|lt|gt);/g,
        (entity) =>
          ({
            "&amp;": "&",
            "&quot;": '"',
            "&apos;": "'",
            "&lt;": "<",
            "&gt;": ">",
          })[entity]!,
      ),
    ]),
  );
}

function inspectZip(bytes: Uint8Array): void {
  if (
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b ||
    bytes[2] !== 3 ||
    bytes[3] !== 4
  )
    fail("INVALID_CONTAINER", "文件不是有效的 XLSX 容器。");
  const centralNames = inspectZipDirectory(bytes);
  const names = new Set<string>();
  const xmlMetadata = new Map<string, string>();
  const formulas: { file: string; cell?: string }[] = [];
  let total = 0;
  let cells = 0;
  let count = 0;
  const unzip = new Unzip((file) => {
    if (++count > MAX_ZIP_ENTRIES) fail("FILE_TOO_LARGE", "ZIP 条目过多。");
    const name = file.name;
    if (
      names.has(name) ||
      name.includes("..") ||
      name.startsWith("/") ||
      name.includes("\\")
    )
      fail("UNSAFE_CONTAINER", "ZIP 含重复或不安全路径。");
    names.add(name);
    if (
      /vba|macro|externalLinks|connections\.xml|embeddings\/|activeX\//i.test(
        name,
      )
    )
      fail("UNSAFE_CONTAINER", "不接受宏、外部链接或嵌入对象。");
    if ((file.originalSize ?? 0) > MAX_EXPANDED_BYTES)
      fail("FILE_TOO_LARGE", "解压后内容超过 20MiB。");
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const textParts: string[] = [];
    const isXml = /\.(?:xml|rels)$/i.test(name);
    file.ondata = (error, data, final) => {
      // fflate 会把回调抛出的业务限额错误再次送入 ondata；保留原始错误码。
      if (error instanceof ImportFailure) throw error;
      if (error) fail("INVALID_CONTAINER", "ZIP 解压失败。");
      total += data.byteLength;
      if (total > MAX_EXPANDED_BYTES) {
        file.terminate();
        fail("FILE_TOO_LARGE", "实际解压内容超过 20MiB。");
      }
      if (isXml) textParts.push(decoder.decode(data, { stream: !final }));
      if (!final || !isXml) return;
      const xml = textParts.join("");
      if (
        /<!DOCTYPE|<!ENTITY|TargetMode\s*=\s*["']External["']|macroEnabled|vbaProject/i.test(
          xml,
        )
      )
        fail("UNSAFE_CONTAINER", "不接受宏、外部链接或 XML 实体。");
      if (name === "xl/workbook.xml" || name === "xl/_rels/workbook.xml.rels")
        xmlMetadata.set(name, xml);
      let address: string | undefined;
      let counted = false;
      for (const tag of xml.matchAll(
        /<(\/?)(?:[\w.-]+:)?(c|v|is|f|formula|formula1|formula2|definedName)\b[^>]*>/g,
      )) {
        if (tag[2] === "c") {
          address = tag[1] ? undefined : xmlAttributes(tag[0]).r;
          counted = false;
        } else if (
          !tag[1] &&
          ["f", "formula", "formula1", "formula2", "definedName"].includes(
            tag[2],
          )
        ) {
          formulas.push({ file: name, cell: address });
          break;
        } else if (
          !tag[1] &&
          !counted &&
          /^xl\/worksheets\//.test(name) &&
          ["v", "is"].includes(tag[2])
        ) {
          counted = true;
          if (++cells > MAX_CELLS)
            fail("FILE_TOO_LARGE", "非空单元格超过 20000 个。");
        }
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  // 小块输入让实际解压计数先于后续解压执行，不依赖可伪造的 ZIP 体积声明。
  for (let offset = 0; offset < bytes.length; offset += 4096)
    unzip.push(
      bytes.subarray(offset, offset + 4096),
      offset + 4096 >= bytes.length,
    );
  if (
    names.size !== centralNames.size ||
    [...names].some((name) => !centralNames.has(name))
  )
    fail("UNSAFE_CONTAINER", "ZIP 流与中央目录条目不一致。");
  if (formulas.length) {
    const formula = formulas[0];
    const relationship = [
      ...(xmlMetadata.get("xl/_rels/workbook.xml.rels") ?? "").matchAll(
        /<(?:[\w.-]+:)?Relationship\b[^>]*\/?\s*>/g,
      ),
    ]
      .map((match) => xmlAttributes(match[0]))
      .find(
        (attrs) =>
          (attrs.Target?.startsWith("/")
            ? attrs.Target.slice(1)
            : "xl/" + attrs.Target) === formula.file,
      );
    const sheet = [
      ...(xmlMetadata.get("xl/workbook.xml") ?? "").matchAll(
        /<(?:[\w.-]+:)?sheet\b[^>]*\/?\s*>/g,
      ),
    ]
      .map((match) => xmlAttributes(match[0]))
      .find((attrs) => attrs["r:id"] === relationship?.Id);
    fail("UNSAFE_CELL", "不接受公式，即使存在缓存结果也不能导入。", "", {
      sheet: sheet?.name ?? formula.file,
      ...(formula.cell ? { cell: formula.cell } : {}),
    });
  }
  if (!names.has("[Content_Types].xml") || !names.has("xl/workbook.xml"))
    fail("INVALID_CONTAINER", "容器缺少 XLSX 必需文件。");
}

const layouts = {
  实验信息: ["字段", "值"],
  样品: ["样品ID", "样品编码", "管理名称", "显示名称"],
  指标定义: [
    "指标ID",
    "大类",
    "指标名",
    "说明",
    "形式",
    "量程下限",
    "量程上限",
    "步长",
    "必答",
    "允许无法评价",
    "方向",
    "分析尺度",
  ],
  评分档位: ["指标ID", "序号", "描述", "下限", "上限"],
  文字题: ["题目ID", "题目", "说明", "必答", "字数上限"],
} as const;
type SheetName = keyof typeof layouts;
const experimentFields = [
  ["格式版本", "schema_version"],
  ["实验名称", "title"],
  ["实验说明", "description"],
  ["填写说明", "instructions"],
  ["时区", "time_zone"],
  ["开放时间", "opens_at"],
  ["截止时间", "closes_at"],
  ["显示样品名称", "display_sample_names"],
  ["实验设计", "design"],
  ["样品顺序", "sample_order"],
] as const;

interface TableRow {
  values: Record<string, Scalar>;
  locations: Record<string, Location>;
}
function readTables(book: Workbook): Record<SheetName, TableRow[]> {
  let cellCount = 0;
  let textBytes = 0;
  const encoder = new TextEncoder();
  const tables = {} as Record<SheetName, TableRow[]>;
  for (const sheet of book.worksheets) {
    if (sheet.name !== "模板说明" && !Object.hasOwn(layouts, sheet.name))
      fail("UNKNOWN_SHEET", `未知工作表：${sheet.name}。`, "", {
        sheet: sheet.name,
      });
    if (Object.keys(sheet.model.merges ?? {}).length)
      fail("MERGED_CELLS", "配置工作表不能合并单元格。", "", {
        sheet: sheet.name,
      });
    sheet.eachRow((row) =>
      row.eachCell((cell) => {
        if (cell.value === null || cell.value === "") return;
        if (++cellCount > MAX_CELLS)
          fail("FILE_TOO_LARGE", "非空单元格超过 20000 个。");
        if (typeof cell.value === "string")
          textBytes += encoder.encode(cell.value).byteLength;
        if (textBytes > MAX_EXPANDED_BYTES)
          fail("FILE_TOO_LARGE", "文本内容超过 20MiB。");
        if (typeof cell.value === "object")
          fail(
            "UNSAFE_CELL",
            "仅接受文本、数字和布尔值，不接受公式、日期、链接或错误单元格。",
            "",
            { sheet: sheet.name, cell: cell.address },
          );
      }),
    );
  }
  for (const [sheetName, expected] of Object.entries(layouts) as [
    SheetName,
    readonly string[],
  ][]) {
    const sheet = book.getWorksheet(sheetName);
    if (!sheet)
      fail("MISSING_SHEET", `缺少工作表：${sheetName}。`, "", {
        sheet: sheetName,
      });
    const columns = new Map<string, number>();
    sheet.getRow(1).eachCell((cell) => {
      if (cell.value === null || cell.value === "") return;
      const header = String(cell.value);
      const location = { sheet: sheetName, cell: cell.address };
      if (!expected.includes(header))
        fail("UNKNOWN_COLUMN", `未知表头：${header}。`, "", location);
      if (columns.has(header))
        fail("DUPLICATE_COLUMN", `表头重复：${header}。`, "", location);
      columns.set(header, Number(cell.col));
    });
    for (const header of expected)
      if (!columns.has(header))
        fail("MISSING_COLUMN", `缺少表头：${header}。`, "", {
          sheet: sheetName,
          cell: "A1",
        });
    const rows: TableRow[] = [];
    sheet.eachRow((row, index) => {
      if (index === 1) return;
      let nonempty = false;
      row.eachCell((cell) => {
        if (cell.value !== null && cell.value !== "") nonempty = true;
      });
      if (!nonempty) return;
      row.eachCell((cell) => {
        if (
          cell.value !== null &&
          cell.value !== "" &&
          ![...columns.values()].includes(Number(cell.col))
        )
          fail("UNKNOWN_COLUMN", "表头范围外存在数据。", "", {
            sheet: sheetName,
            cell: cell.address,
          });
      });
      const values: Record<string, Scalar> = {};
      const locations: Record<string, Location> = {};
      for (const [header, column] of columns) {
        const cell = row.getCell(column);
        values[header] = (cell.value ?? "") as Scalar;
        locations[header] = { sheet: sheetName, cell: cell.address };
      }
      rows.push({ values, locations });
    });
    if (!rows.length && sheetName !== "评分档位" && sheetName !== "文字题")
      fail("EMPTY_SHEET", `工作表 ${sheetName} 不能为空。`, "", {
        sheet: sheetName,
      });
    tables[sheetName] = rows;
  }
  return tables;
}

function tableConfig(tables: Record<SheetName, TableRow[]>): {
  raw: unknown;
  locations: Map<string, Location>;
} {
  const locations = new Map<string, Location>();
  const read = (
    row: TableRow,
    header: string,
    path: string,
    kind: "text" | "number" | "boolean" | "date" = "text",
  ): Scalar => {
    const value = row.values[header];
    const location = row.locations[header];
    locations.set(path, location);
    if (kind === "boolean") {
      if (value === true || value === "true" || value === "是") return true;
      if (value === false || value === "false" || value === "否") return false;
      return fail(
        "INVALID_BOOLEAN",
        "布尔值只接受 true、false、是、否。",
        path,
        location,
      );
    }
    if (kind === "number") {
      if (
        typeof value !== "number" &&
        (typeof value !== "string" ||
          !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value))
      )
        fail("INVALID_NUMBER", "请使用标准十进制数字。", path, location);
      const numeric = Number(value);
      if (!Number.isFinite(numeric))
        fail("INVALID_NUMBER", "数值必须有限。", path, location);
      if (scaled(value as string | number) === null)
        fail("DECIMAL_PRECISION", "数值最多两位有效小数。", path, location);
      return numeric;
    }
    if (typeof value !== "string")
      fail(
        kind === "date" ? "INVALID_DATE_TEXT" : "TEXT_REQUIRED",
        kind === "date"
          ? "时间必须是带时区的 ISO 8601 文本。"
          : "此字段必须使用文本单元格；编码如 001 不得使用数字格式替代。",
        path,
        location,
      );
    const text = value.normalize("NFC");
    return kind === "date" && text === ""
      ? null
      : /\/(?:\w+_id|code)$/.test(path)
        ? text.trim()
        : text;
  };
  const info: Record<string, Scalar> = {};
  for (const row of tables.实验信息) {
    const name = row.values.字段;
    const field = experimentFields.find(([label]) => label === name);
    if (!field)
      fail(
        "UNKNOWN_FIELD",
        `未知实验字段：${String(name)}。`,
        "/experiment",
        row.locations.字段,
      );
    const [, key] = field;
    if (Object.hasOwn(info, key))
      fail(
        "DUPLICATE_FIELD",
        `实验字段重复：${String(name)}。`,
        "/experiment",
        row.locations.字段,
      );
    const path =
      key === "schema_version" ? "/schema_version" : `/experiment/${key}`;
    info[key] = read(
      row,
      "值",
      path,
      key === "display_sample_names"
        ? "boolean"
        : key === "opens_at" || key === "closes_at"
          ? "date"
          : "text",
    );
  }
  for (const [, field] of experimentFields)
    if (!Object.hasOwn(info, field))
      fail("MISSING_FIELD", `缺少实验字段：${field}。`, "/experiment", {
        sheet: "实验信息",
      });
  const samples = tables.样品.map((row, index) => {
    const object: Record<string, Scalar> = {};
    for (const [header, key] of [
      ["样品ID", "sample_id"],
      ["样品编码", "code"],
      ["管理名称", "admin_name"],
      ["显示名称", "display_name"],
    ])
      object[key] = read(row, header, `/samples/${index}/${key}`);
    return object;
  });
  const indicators = tables.指标定义.map((row, index) => {
    const object: Record<string, unknown> = { anchors: [] };
    const fields = [
      ["指标ID", "indicator_id"],
      ["大类", "category"],
      ["指标名", "label"],
      ["说明", "description"],
      ["形式", "kind"],
      ["量程下限", "min"],
      ["量程上限", "max"],
      ["步长", "step"],
      ["必答", "required"],
      ["允许无法评价", "allow_not_evaluable"],
      ["方向", "direction"],
      ["分析尺度", "analysis_scale"],
    ];
    for (const [header, key] of fields)
      object[key] = read(
        row,
        header,
        `/indicators/${index}/${key}`,
        ["min", "max", "step"].includes(key)
          ? "number"
          : ["required", "allow_not_evaluable"].includes(key)
            ? "boolean"
            : "text",
      );
    return object;
  });
  const anchorRows = new Map<number, { sequence: number; row: TableRow }[]>();
  for (const row of tables.评分档位) {
    const id = String(read(row, "指标ID", "/indicators"))
      .trim()
      .normalize("NFC");
    const index = indicators.findIndex((item) => item.indicator_id === id);
    if (index < 0)
      fail(
        "UNKNOWN_REFERENCE",
        "档位引用的指标不存在。",
        "/indicators",
        row.locations.指标ID,
      );
    if (indicators[index].kind !== "anchored")
      fail(
        "INVALID_ANCHOR_REFERENCE",
        "连续形式指标不能定义档位。",
        `/indicators/${index}/anchors`,
        row.locations.指标ID,
      );
    const sequence = read(
      row,
      "序号",
      `/indicators/${index}/anchors`,
      "number",
    ) as number;
    const list = anchorRows.get(index) ?? [];
    list.push({ sequence, row });
    anchorRows.set(index, list);
  }
  for (const [index, entries] of anchorRows) {
    entries.sort((a, b) => a.sequence - b.sequence);
    indicators[index].anchors = entries.map(({ sequence, row }, position) => {
      const path = `/indicators/${index}/anchors/${position}`;
      if (sequence !== position + 1)
        fail(
          "INVALID_ANCHOR_SEQUENCE",
          "档位序号必须从 1 连续递增且不重复。",
          path,
          row.locations.序号,
        );
      return {
        label: read(row, "描述", `${path}/label`),
        from: read(row, "下限", `${path}/from`, "number"),
        to: read(row, "上限", `${path}/to`, "number"),
      };
    });
  }
  const text_questions = tables.文字题.map((row, index) => {
    const object: Record<string, Scalar> = {};
    for (const [header, key] of [
      ["题目ID", "text_question_id"],
      ["题目", "label"],
      ["说明", "description"],
      ["必答", "required"],
      ["字数上限", "max_length"],
    ])
      object[key] = read(
        row,
        header,
        `/text_questions/${index}/${key}`,
        key === "required"
          ? "boolean"
          : key === "max_length"
            ? "number"
            : "text",
      );
    return object;
  });
  const { schema_version, ...experiment } = info;
  return {
    raw: { schema_version, experiment, samples, indicators, text_questions },
    locations,
  };
}

function countJsonCells(value: unknown): number {
  if (Array.isArray(value))
    return value.reduce((sum, item) => sum + countJsonCells(item), 0);
  if (value && typeof value === "object")
    return Object.values(value).reduce<number>(
      (sum, item) => sum + countJsonCells(item),
      0,
    );
  return value === null || value === "" ? 0 : 1;
}

export async function parseImportBytes(
  bytes: Uint8Array,
  filename: string,
): Promise<ImportResult> {
  try {
    if (bytes.byteLength > MAX_FILE_BYTES)
      fail("FILE_TOO_LARGE", "文件不得超过 5MiB。");
    const extension = filename.split(".").pop()?.toLowerCase();
    let raw: unknown;
    let locations = new Map<string, Location>();
    if (extension === "json") {
      const text = new TextDecoder("utf-8", { fatal: true })
        .decode(bytes)
        .replace(/^\uFEFF/, "");
      raw = JSON.parse(text);
      if (countJsonCells(raw) > MAX_CELLS)
        fail("FILE_TOO_LARGE", "非空字段超过 20000 个。");
    } else if (extension === "xlsx") {
      inspectZip(bytes);
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(bytes as never);
      ({ raw, locations } = tableConfig(readTables(book)));
    } else
      fail(
        "UNSUPPORTED_FILE",
        "仅支持正式模板 .json 和 .xlsx；旧三表模板请按正式模板整理。",
      );
    const issues = validateConfig(raw).map((issue) => ({
      ...issue,
      ...(locations.get(issue.path) ?? {}),
    }));
    return issues.length
      ? { config: null, issues }
      : { config: normalizeConfig(raw), issues: [] };
  } catch (error) {
    return {
      config: null,
      issues: [
        error instanceof ImportFailure
          ? error.issue
          : {
              code: "INVALID_FILE",
              path: "",
              message:
                error instanceof SyntaxError
                  ? "JSON 语法无效。"
                  : "文件内容无效或损坏，请按正式模板检查。",
            },
      ],
    };
  }
}

function sheetWithRows(
  book: Workbook,
  name: string,
  headers: readonly string[],
  rows: Scalar[][],
): Worksheet {
  const sheet = book.addWorksheet(name);
  sheet.addRow([...headers]);
  sheet.addRows(rows);
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF264653" },
  };
  sheet.columns.forEach((column, index) => {
    column.width = index === 0 ? 24 : 22;
  });
  sheet.eachRow((row) =>
    row.eachCell((cell) => {
      if (typeof cell.value === "string") cell.numFmt = "@";
    }),
  );
  return sheet;
}

export async function configToXlsx(
  config: ExperimentConfig,
): Promise<Uint8Array> {
  const issues = validateConfig(config);
  if (issues.length) throw new Error("配置尚未通过正式校验，不能导出。");
  const normalized = normalizeConfig(config);
  const book = new ExcelJS.Workbook();
  sheetWithRows(
    book,
    "实验信息",
    layouts.实验信息,
    experimentFields.map(([label, field]) => [
      label,
      field === "schema_version"
        ? normalized.schema_version
        : normalized.experiment[field],
    ]),
  );
  sheetWithRows(
    book,
    "样品",
    layouts.样品,
    normalized.samples.map((sample) => [
      sample.sample_id,
      sample.code,
      sample.admin_name ?? "",
      sample.display_name ?? "",
    ]),
  );
  sheetWithRows(
    book,
    "指标定义",
    layouts.指标定义,
    normalized.indicators.map((item) => [
      item.indicator_id,
      item.category,
      item.label,
      item.description,
      item.kind,
      item.min,
      item.max,
      item.step,
      item.required,
      item.allow_not_evaluable,
      item.direction,
      item.analysis_scale,
    ]),
  );
  sheetWithRows(
    book,
    "评分档位",
    layouts.评分档位,
    normalized.indicators.flatMap((item) =>
      item.anchors.map((anchor, index) => [
        item.indicator_id,
        index + 1,
        anchor.label,
        anchor.from,
        anchor.to,
      ]),
    ),
  );
  sheetWithRows(
    book,
    "文字题",
    layouts.文字题,
    normalized.text_questions.map((item) => [
      item.text_question_id,
      item.label,
      item.description,
      item.required,
      item.max_length,
    ]),
  );
  sheetWithRows(
    book,
    "模板说明",
    ["项目", "说明"],
    [
      [
        "格式",
        "五表均需保留；表头可换序，不得新增列。样品编码如 001 必须为文本；日期必须是带时区的 ISO 8601 文本。",
      ],
      [
        "布尔",
        "仅接受 true、false、是、否；数值不要添加千分符、百分号；不接受公式、宏和外部链接。",
      ],
      [
        "形式",
        "continuous：连续形式；anchored：档位说明形式。档位左闭右开，最后一档右闭。",
      ],
      [
        "方向",
        "higher_better：越高越好；lower_better：越低越好；neutral：中性。方向不自动改变分数。",
      ],
      ["分析尺度", "interval：等距评分；ordinal：有序评分，仅提供描述统计。"],
    ],
  );
  return new Uint8Array(await book.xlsx.writeBuffer());
}

export const templateConfig = (): ExperimentConfig => normalizeConfig(template);

const numericHeaders = [
  "participant_code",
  "sample_id",
  "sample_code",
  "indicator_id",
  "category",
  "label",
  "value",
  "missing_reason",
  "response_id",
  "revision_id",
  "revision_no",
  "submitted_at",
  "config_version_id",
];
const textHeaders = [
  "participant_code",
  "sample_id",
  "sample_code",
  "text_question_id",
  "value",
  "response_id",
  "revision_id",
  "submitted_at",
];
function resultRows(snapshot: Snapshot, kind: "numeric" | "text"): Scalar[][] {
  return snapshot.rows.flatMap((row) => {
    const sample = snapshot.config.samples.find(
      (item) => item.sample_id === row.sample_id,
    );
    if (!sample) throw new Error("快照引用未知样品。");
    if (kind === "numeric")
      return row.answers.numeric.map((answer) => {
        const indicator = snapshot.config.indicators.find(
          (item) => item.indicator_id === answer.indicator_id,
        );
        if (!indicator) throw new Error("快照引用未知指标。");
        return [
          row.participant_code,
          row.sample_id,
          sample.code,
          answer.indicator_id,
          indicator.category,
          indicator.label,
          answer.value,
          answer.missing_reason,
          row.response_id,
          row.revision_id,
          row.revision_no,
          row.submitted_at,
          snapshot.config_version_id ?? "",
        ];
      });
    return row.answers.text.map((answer) => [
      row.participant_code,
      row.sample_id,
      sample.code,
      answer.text_question_id,
      answer.value,
      row.response_id,
      row.revision_id,
      row.submitted_at,
    ]);
  });
}

export function encodeCsv(rows: Scalar[][]): string {
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((value) => {
            if (value === null) return "";
            if (typeof value === "number") {
              if (!Number.isFinite(value))
                throw new Error("不能导出非有限数值。");
              return String(value);
            }
            let text = String(value);
            const dangerous =
              /^[\s\u0000-\u0020\u007f-\u009f]*[=+\-@＝＋－＠]|^[\u0000-\u001f\u007f-\u009f]/u.test(
                text,
              );
            if (dangerous) text = "'" + text;
            return dangerous || /[",\r\n]/.test(text)
              ? '"' + text.replace(/"/g, '""') + '"'
              : text;
          })
          .join(","),
      )
      .join("\r\n") +
    "\r\n"
  );
}

export function resultsToCsv(
  snapshot: Snapshot,
  kind: "numeric" | "text",
): string {
  return encodeCsv([
    kind === "numeric" ? numericHeaders : textHeaders,
    ...resultRows(snapshot, kind),
  ]);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map(
          (key) =>
            JSON.stringify(key) +
            ":" +
            canonical((value as Record<string, unknown>)[key]),
        )
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}

export async function resultsToXlsx(snapshot: Snapshot): Promise<Uint8Array> {
  const frozen: Snapshot = structuredClone(snapshot);
  const book = new ExcelJS.Workbook();
  const hash = [
    ...new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonical(frozen.config)),
      ),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  sheetWithRows(
    book,
    "导出说明",
    ["项目", "值"],
    [
      ["模式", frozen.mode ?? "demo"],
      ["是否示例", frozen.is_synthetic ?? true],
      ["实验ID", frozen.experiment_id],
      ["配置版本ID", frozen.config_version_id ?? ""],
      ["快照ID", frozen.snapshot_id],
      ["数据版本", frozen.data_revision],
      ["快照生成时间 UTC", frozen.created_at],
      ["导出生成时间 UTC", new Date().toISOString()],
      ["时区", frozen.config.experiment.time_zone],
      ["输入哈希", frozen.input_hash],
      [
        "纳入规则",
        "仅含冻结快照中账户激活、任务 active、当前 submitted 且配置一致的最新提交；不含草稿和旧修订。",
      ],
      [
        "缺失说明",
        "n_missing 仅指纳入的提交中该指标为空；未提交、退回、撤销、停用另见任务覆盖。空统计量表示不可计算，不得解释为 0。",
      ],
      [
        "统计方法",
        "描述统计：样本标准差，Hyndman–Fan type 7 分位数；0 是有效分数，不补齐缺失，不自动剔除极端值。",
      ],
      [
        "CSV 显示转义",
        "危险文本前缀添加单引号并双引号包裹，数值评分保持数值；请勿执行公式。再次保存/打开的行为取决于软件，人工查看优先使用此 XLSX。",
      ],
      ["软件版本", "sensory-questionnaire 1.0.0 / descriptive_type7_v1"],
    ],
  );
  sheetWithRows(
    book,
    "数值明细",
    numericHeaders,
    resultRows(frozen, "numeric"),
  );
  sheetWithRows(book, "文字明细", textHeaders, resultRows(frozen, "text"));
  const descriptions = summarize(frozen);
  const statHeaders = [
    "sample_id",
    "indicator_id",
    "n_valid",
    "n_missing",
    "mean",
    "sd",
    "median",
    "q1",
    "q3",
    "min",
    "max",
    "status",
    "说明",
  ];
  sheetWithRows(
    book,
    "描述统计",
    statHeaders,
    descriptions.map((row) => [
      ...statHeaders.slice(0, 11).map((key) => row[key as keyof typeof row]),
      row.n_valid ? "ok" : "not_computable",
      row.n_valid === 0
        ? "无有效分数，统计量为空。"
        : row.n_valid === 1
          ? "仅一个有效分数，样本标准差不可计算。"
          : "",
    ]),
  );
  const coverageHeaders = [
    "participant_code",
    "assignment_id",
    "assignment_state",
    "sample_id",
    "response_state",
    "included",
    "reason",
    "response_id",
    "revision_id",
    "row_type",
  ];
  const coverageRows = frozen.coverage.map((item) =>
    coverageHeaders.map((key) => {
      if (key === "row_type") return "task_sample";
      const value = (item as unknown as Record<string, unknown>)[key];
      return value === undefined || value === null
        ? ""
        : typeof value === "object"
          ? JSON.stringify(value)
          : (value as Scalar);
    }),
  );
  for (const revision of frozen.excluded_revisions ?? []) {
    const row = frozen.rows.find(
      (item) => item.response_id === revision.response_id,
    );
    coverageRows.push([
      row?.participant_code ?? "",
      "",
      "",
      row?.sample_id ?? "",
      "",
      false,
      revision.reason,
      revision.response_id,
      revision.revision_id,
      "excluded_revision",
    ]);
  }
  sheetWithRows(book, "任务覆盖", coverageHeaders, coverageRows);
  const configJson = canonical(frozen.config);
  const chunks: string[] = [];
  for (let start = 0; start < configJson.length; ) {
    let end = Math.min(start + 30000, configJson.length);
    // 分块仍按 UTF-16 长度遵守 Excel 限制，但不能拆开代理对，否则 XLSX 编码会产生 U+FFFD。
    if (
      end < configJson.length &&
      configJson.charCodeAt(end - 1) >= 0xd800 &&
      configJson.charCodeAt(end - 1) <= 0xdbff &&
      configJson.charCodeAt(end) >= 0xdc00 &&
      configJson.charCodeAt(end) <= 0xdfff
    )
      end--;
    chunks.push(configJson.slice(start, end));
    start = end;
  }
  sheetWithRows(
    book,
    "实验配置",
    ["项目", "内容"],
    [
      ["配置哈希 SHA-256 / JCS", hash],
      ...chunks.map((chunk, index): Scalar[] => [
        `规范化 JSON ${index + 1}/${chunks.length}（按序直接拼接）`,
        chunk,
      ]),
    ],
  );
  sheetWithRows(
    book,
    "推断分析",
    ["status", "reason_code", "说明"],
    [
      [
        "not_available",
        "INFERENCE_NOT_ENABLED",
        "未提供：M1 仅实现描述统计，未部署受控推断服务，不输出 p 值、显著性或字母分组。",
      ],
    ],
  );
  return new Uint8Array(await book.xlsx.writeBuffer());
}
