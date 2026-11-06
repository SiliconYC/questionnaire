import {
  configToXlsx,
  parseImportBytes,
  resultsToCsv,
  resultsToXlsx,
  templateConfig,
} from "../features/files/core";
import type { FileJob } from "../features/files";
import { normalizeConfig, validateConfig } from "../domain/validation";

const xlsxMime =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const safeId = (value: string) =>
  value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);

self.onmessage = async (event: MessageEvent<FileJob>) => {
  try {
    const job = event.data;
    let value: unknown;
    if (job.kind === "import")
      value = await parseImportBytes(
        new Uint8Array(await job.file.arrayBuffer()),
        job.file.name,
      );
    else if (job.kind === "template")
      value = {
        bytes: await configToXlsx(templateConfig()),
        mime: xlsxMime,
        filename: "questionnaire_template.xlsx",
      };
    else if (job.kind === "config") {
      if (validateConfig(job.config).length)
        throw new Error("配置尚未通过正式校验，不能导出。");
      const config = normalizeConfig(job.config);
      value = {
        bytes:
          job.format === "xlsx"
            ? await configToXlsx(config)
            : new TextEncoder().encode(JSON.stringify(config, null, 2)),
        mime:
          job.format === "xlsx" ? xlsxMime : "application/json;charset=utf-8",
        filename: `questionnaire_config.${job.format}`,
      };
    } else {
      const snapshot = job.snapshot;
      const format = job.format;
      value = {
        bytes:
          format === "xlsx"
            ? await resultsToXlsx(snapshot)
            : new TextEncoder().encode(
                resultsToCsv(
                  snapshot,
                  format === "numeric-csv" ? "numeric" : "text",
                ),
              ),
        mime: format === "xlsx" ? xlsxMime : "text/csv;charset=utf-8",
        filename: `questionnaire_${safeId(snapshot.experiment_id)}_${safeId(snapshot.snapshot_id)}_${new Date().toISOString().replace(/[:.]/g, "-")}${format === "xlsx" ? "" : format === "numeric-csv" ? "_numeric" : "_text"}.${format === "xlsx" ? "xlsx" : "csv"}`,
      };
    }
    const bytes = (value as { bytes?: Uint8Array })?.bytes;
    self.postMessage(
      { ok: true, value },
      bytes ? { transfer: [bytes.buffer] } : undefined,
    );
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : "文件处理失败。",
    });
  }
};
