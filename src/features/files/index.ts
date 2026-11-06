import type { ExperimentConfig, Issue, Snapshot } from "../../domain/types";
import type { ImportResult } from "./core";

type Download = { bytes: Uint8Array; mime: string; filename: string };
export type FileJob =
  | { kind: "import"; file: File }
  | { kind: "config"; config: ExperimentConfig; format: "json" | "xlsx" }
  | { kind: "template" }
  | {
      kind: "results";
      snapshot: Snapshot;
      format: "xlsx" | "numeric-csv" | "text-csv";
    };

function runJob<T>(job: FileJob, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("操作已取消。", "AbortError"));
      return;
    }
    const worker = new Worker(
      new URL("../../workers/files.worker.ts", import.meta.url),
      { type: "module" },
    );
    const finish = (error: Error | null, value?: T) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      worker.terminate();
      if (error) reject(error);
      else resolve(value as T);
    };
    const abort = () => finish(new DOMException("操作已取消。", "AbortError"));
    const timer = setTimeout(
      () =>
        finish(
          Object.assign(new Error("文件处理超过 10 秒，已终止。"), {
            code: "FILE_TIMEOUT",
          }),
        ),
      10_000,
    );
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (
      event: MessageEvent<{ ok: boolean; value?: T; error?: string }>,
    ) => {
      if (event.data.ok) finish(null, event.data.value);
      else finish(new Error(event.data.error ?? "文件处理失败。"));
    };
    worker.onerror = () => finish(new Error("文件处理工作线程失败，请重试。"));
    worker.onmessageerror = () => finish(new Error("无法读取文件处理结果。"));
    try {
      worker.postMessage(job);
    } catch (error) {
      finish(error instanceof Error ? error : new Error("文件处理失败。"));
    }
  });
}

function save(download: Download): void {
  const url = URL.createObjectURL(
    new Blob([download.bytes as BlobPart], { type: download.mime }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = download.filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function parseImport(
  file: File,
  signal?: AbortSignal,
): Promise<ImportResult> {
  if (file.size > 5 * 1024 * 1024)
    return {
      config: null,
      issues: [
        { code: "FILE_TOO_LARGE", path: "", message: "文件不得超过 5MiB。" },
      ],
    };
  return runJob<ImportResult>({ kind: "import", file }, signal);
}

export async function downloadConfig(
  config: ExperimentConfig,
  format: "json" | "xlsx",
  signal?: AbortSignal,
): Promise<void> {
  save(await runJob<Download>({ kind: "config", config, format }, signal));
}

export async function downloadTemplate(signal?: AbortSignal): Promise<void> {
  save(await runJob<Download>({ kind: "template" }, signal));
}

export async function downloadResults(
  snapshot: Snapshot,
  format: "xlsx" | "numeric-csv" | "text-csv",
  signal?: AbortSignal,
): Promise<void> {
  save(await runJob<Download>({ kind: "results", snapshot, format }, signal));
}

export function downloadIssues(issues: Issue[]): void {
  save({
    bytes: new TextEncoder().encode(JSON.stringify({ issues }, null, 2)),
    mime: "application/json;charset=utf-8",
    filename: "questionnaire_import_issues.json",
  });
}
