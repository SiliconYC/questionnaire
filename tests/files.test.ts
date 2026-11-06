import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import fixture from "../docs/examples/experiment-valid.json";
import type { ExperimentConfig, Snapshot } from "../src/domain/types";
import {
  configToXlsx,
  encodeCsv,
  parseImportBytes,
  resultsToCsv,
  resultsToXlsx,
} from "../src/features/files/core";
import { parseImport } from "../src/features/files";
import { canonical } from "../src/domain/hash";
import { validateConfig } from "../src/domain/validation";

const config = fixture as ExperimentConfig;
const encode = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));
async function mutateWorkbook(change: (book: ExcelJS.Workbook) => void) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await configToXlsx(config)) as never);
  change(book);
  return new Uint8Array(await book.xlsx.writeBuffer());
}

describe("configuration import/export", () => {
  it("round trips all five sheets and keeps code 001 as text", async () => {
    const bytes = await configToXlsx(config);
    const result = await parseImportBytes(bytes, "config.xlsx");
    expect(result.issues).toEqual([]);
    expect(result.config).toEqual(config);
    expect(result.config?.samples[0].code).toBe("001");
  });
  it("normalizes stable IDs before resolving anchor references", async () => {
    const bytes = await mutateWorkbook((book) => {
      book.getWorksheet("指标定义")!.getCell("A2").value = " color_depth ";
      book.getWorksheet("评分档位")!.getCell("A2").value = "color_depth ";
      book.getWorksheet("样品")!.getCell("B2").value = " 001 ";
    });
    const result = await parseImportBytes(bytes, "config.xlsx");
    expect(result.issues).toEqual([]);
    expect(result.config).toEqual(config);
  });
  it("reports the exact unknown column", async () => {
    const bytes = await mutateWorkbook((book) => {
      book.getWorksheet("样品")!.getCell("E1").value = "未知";
    });
    const result = await parseImportBytes(bytes, "config.xlsx");
    expect(result.config).toBeNull();
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "UNKNOWN_COLUMN",
        sheet: "样品",
        cell: "E1",
      }),
    );
  });
  it("maps reordered columns by header names and rejects missing or duplicate headers", async () => {
    const reordered = await mutateWorkbook((book) => {
      const sheet = book.getWorksheet("样品")!;
      sheet.eachRow((row) => {
        const a = row.getCell(1).value;
        row.getCell(1).value = row.getCell(2).value;
        row.getCell(2).value = a;
      });
    });
    expect((await parseImportBytes(reordered, "config.xlsx")).config).toEqual(
      config,
    );
    for (const [value, code] of [
      ["样品ID", "DUPLICATE_COLUMN"],
      [null, "MISSING_COLUMN"],
    ] as const) {
      const bytes = await mutateWorkbook((book) => {
        book.getWorksheet("样品")!.getCell("B1").value = value;
      });
      expect(
        (await parseImportBytes(bytes, "config.xlsx")).issues[0].code,
      ).toBe(code);
    }
  });
  it("locates formula rejection without using its cached value", async () => {
    const bytes = await mutateWorkbook((book) => {
      book.getWorksheet("样品")!.getCell("B2").value = {
        formula: "1+1",
        result: 2,
      };
    });
    expect(
      (await parseImportBytes(bytes, "config.xlsx")).issues[0],
    ).toMatchObject({ sheet: "样品", cell: "B2" });
  });
  it("rejects formula-bearing defined names and validation formulas", async () => {
    for (const formula of [
      '<definedName name="attack">1+1</definedName>',
      "<formula1>1+1</formula1>",
    ]) {
      const entries = unzipSync(await configToXlsx(config));
      entries["xl/workbook.xml"] = strToU8(
        strFromU8(entries["xl/workbook.xml"]).replace(
          "</workbook>",
          formula + "</workbook>",
        ),
      );
      expect(
        (await parseImportBytes(zipSync(entries), "config.xlsx")).issues[0]
          .code,
      ).toBe("UNSAFE_CELL");
    }
  });
  it("rejects formulas including cached results, numeric sample codes and date serials", async () => {
    for (const change of [
      (book: ExcelJS.Workbook) => {
        book.getWorksheet("样品")!.getCell("B2").value = {
          formula: "1+1",
          result: 2,
        };
      },
      (book: ExcelJS.Workbook) => {
        book.getWorksheet("样品")!.getCell("B2").value = 1;
        book.getWorksheet("样品")!.getCell("B2").numFmt = "000";
      },
      (book: ExcelJS.Workbook) => {
        book.getWorksheet("实验信息")!.getCell("B7").value = new Date();
      },
    ]) {
      const result = await parseImportBytes(
        await mutateWorkbook(change),
        "config.xlsx",
      );
      expect(result.config).toBeNull();
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });
  it("rejects external links, macros and actual inflated zip bombs", async () => {
    for (const entries of [
      { "xl/externalLinks/externalLink1.xml": strToU8("<externalLink/>") },
      { "xl/vbaProject.bin": new Uint8Array([1]) },
      { "xl/worksheets/sheet1.xml": strToU8("x".repeat(21 * 1024 * 1024)) },
    ] as Zippable[]) {
      const result = await parseImportBytes(zipSync(entries), "attack.xlsx");
      expect(result.config).toBeNull();
      expect(result.issues[0].code).toMatch(/UNSAFE|TOO_LARGE/);
    }
  });
  it("rejects unsupported containers, oversize JSON and invalid schema", async () => {
    expect(
      (await parseImportBytes(encode(config), "config.xls")).issues[0].code,
    ).toBe("UNSUPPORTED_FILE");
    expect(
      (
        await parseImportBytes(
          new Uint8Array(5 * 1024 * 1024 + 1),
          "config.json",
        )
      ).issues[0].code,
    ).toBe("FILE_TOO_LARGE");
    expect(
      (await parseImportBytes(encode({ ...config, typo: 1 }), "config.json"))
        .config,
    ).toBeNull();
  });
  it("enforces the actual inflated budget despite forged ZIP uncompressed sizes", async () => {
    const bytes = zipSync({
      "xl/worksheets/sheet1.xml": strToU8("x".repeat(21 * 1024 * 1024)),
    });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint32(22, 1, true);
    for (let offset = 30; offset < bytes.length - 46; offset++)
      if (view.getUint32(offset, true) === 0x02014b50)
        view.setUint32(offset + 24, 1, true);
    expect((await parseImportBytes(bytes, "attack.xlsx")).issues[0].code).toBe(
      "FILE_TOO_LARGE",
    );
  });
  it("rejects a ZIP whose central-directory filename differs from its local filename", async () => {
    const bytes = zipSync({
      "xl/worksheets/sheet1.xml": strToU8("<worksheet/>"),
    });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = 30; offset < bytes.length - 46; offset++)
      if (view.getUint32(offset, true) === 0x02014b50)
        bytes[offset + 46] = "z".charCodeAt(0);
    expect((await parseImportBytes(bytes, "attack.xlsx")).issues[0].code).toBe(
      "UNSAFE_CONTAINER",
    );
  });
  it("rejects an XLSX with over 20000 nonempty cells before workbook materialization", async () => {
    const bytes = zipSync({
      "[Content_Types].xml": strToU8("<Types/>"),
      "xl/workbook.xml": strToU8("<workbook/>"),
      "xl/worksheets/sheet1.xml": strToU8(
        "<worksheet><sheetData><row>" +
          "<c><v>1</v></c>".repeat(20001) +
          "</row></sheetData></worksheet>",
      ),
    });
    expect((await parseImportBytes(bytes, "attack.xlsx")).issues[0].code).toBe(
      "FILE_TOO_LARGE",
    );
  });
});

describe("results export", () => {
  it("preserves supplementary Unicode characters and the config hash across XLSX chunk boundaries", async () => {
    const emojiConfig: ExperimentConfig = structuredClone(config);
    emojiConfig.indicators = Array.from({ length: 20 }, (_, index) => ({
      ...structuredClone(config.indicators[1]),
      indicator_id: `emoji_${index}`,
      description: "😀".repeat(1000),
    }));
    if (
      canonical(emojiConfig).charCodeAt(29_999) >= 0xdc00 &&
      canonical(emojiConfig).charCodeAt(29_999) <= 0xdfff
    )
      emojiConfig.experiment.description += "x";
    expect(validateConfig(emojiConfig)).toEqual([]);
    const expectedJson = canonical(emojiConfig);
    expect(expectedJson.charCodeAt(29_999)).toBeGreaterThanOrEqual(0xd800);
    expect(expectedJson.charCodeAt(29_999)).toBeLessThanOrEqual(0xdbff);
    const snapshot: Snapshot = {
      snapshot_id: "emoji",
      experiment_id: "exp",
      config_version_id: "v1",
      data_revision: 1,
      created_at: "2026-01-01T00:00:00Z",
      input_hash: "input",
      config: emojiConfig,
      rows: [],
      coverage: [],
      mode: "demo",
      is_synthetic: true,
    };
    const book = new ExcelJS.Workbook();
    const exportBytes = await resultsToXlsx(snapshot);
    await book.xlsx.load(exportBytes as never);
    const configSheet = book.getWorksheet("实验配置")!;
    const chunks: string[] = [];
    configSheet.eachRow((row, index) => {
      if (index > 2) chunks.push(String(row.getCell(2).value));
    });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(32767);
      expect(chunk.includes("\uFFFD")).toBe(false);
    }
    const restoredJson = chunks.join("");
    expect(restoredJson).toBe(expectedJson);
    expect(JSON.parse(restoredJson)).toEqual(emojiConfig);
    expect(configSheet.getCell("B2").value).toBe(
      createHash("sha256").update(expectedJson, "utf8").digest("hex"),
    );
    expect(
      createHash("sha256").update(restoredJson, "utf8").digest("hex"),
    ).toBe(configSheet.getCell("B2").value);
  });
  it("escapes dangerous text including fullwidth prefixes while retaining negative numeric scores", () => {
    expect(encodeCsv([["=1+1", "＋1", "\tbad", -2, 'a,"b\nc']])).toBe(
      '\uFEFF"\'=1+1","\'＋1","\'\tbad",-2,"a,""b\nc"\r\n',
    );
  });
  it("exports seven sheets from one frozen snapshot and preserves zero and raw text", async () => {
    const snapshot = {
      snapshot_id: "snap",
      experiment_id: "exp",
      data_revision: 3,
      created_at: "2026-01-01T00:00:00Z",
      input_hash: "hash",
      config,
      rows: [
        {
          participant_code: "P001",
          sample_id: "s_a",
          response_id: "r1",
          revision_id: "v1",
          revision_no: 2,
          submitted_at: "2026-01-01T00:00:00Z",
          answers: {
            numeric: [
              { indicator_id: "roasted_aroma", value: 0, missing_reason: null },
            ],
            text: [{ text_question_id: "texture_note", value: "=1+1" }],
          },
        },
      ],
      coverage: [{ participant_code: "P001", state: "active" }],
      excluded_revisions: [
        {
          response_id: "r1",
          revision_id: "old_revision",
          reason: "historical_revision",
        },
      ],
    } as unknown as Snapshot;
    const before = JSON.stringify(snapshot);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await resultsToXlsx(snapshot)) as never);
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual([
      "导出说明",
      "数值明细",
      "文字明细",
      "描述统计",
      "任务覆盖",
      "实验配置",
      "推断分析",
    ]);
    expect(book.getWorksheet("数值明细")!.getCell("G2").value).toBe(0);
    expect(book.getWorksheet("文字明细")!.getCell("E2").value).toBe("=1+1");
    const coverage = book.getWorksheet("任务覆盖")!;
    expect(coverage.getRow(3).values).toContain("old_revision");
    expect(coverage.getRow(3).values).toContain("historical_revision");
    expect(resultsToCsv(snapshot, "text")).toContain('"\'=1+1"');
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});

describe("worker lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it("rejects an already canceled operation before reading or parsing the file", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      parseImport(new File(["{}"], "config.json"), controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
  it("terminates a stuck worker on cancellation and after the 10 second deadline", async () => {
    vi.useFakeTimers();
    const workers: { stopped: boolean }[] = [];
    class StuckWorker {
      stopped = false;
      constructor() {
        workers.push(this);
      }
      postMessage() {
        /* Simulates an unresponsive worker boundary, with no parsing result. */
      }
      terminate() {
        this.stopped = true;
      }
    }
    vi.stubGlobal("Worker", StuckWorker);
    const controller = new AbortController();
    const canceled = parseImport(
      new File(["{}"], "config.json"),
      controller.signal,
    );
    const canceledCheck = expect(canceled).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await canceledCheck;
    expect(workers[0].stopped).toBe(true);
    const timedOut = parseImport(new File(["{}"], "config.json"));
    const timeoutCheck = expect(timedOut).rejects.toMatchObject({
      code: "FILE_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await timeoutCheck;
    expect(workers[1].stopped).toBe(true);
  });
});
