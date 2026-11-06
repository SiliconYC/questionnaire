import type { Snapshot } from "../../domain/types";

export interface Description {
  n_valid: number;
  n_missing: number;
  mean: number | null;
  sd: number | null;
  median: number | null;
  q1: number | null;
  q3: number | null;
  min: number | null;
  max: number | null;
}

export function describe(values: (number | null)[]): Description {
  const sorted = values
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  if (sorted.some((value) => !Number.isFinite(value)))
    throw new Error("统计输入必须是有限数字或 null。");
  const n = sorted.length;
  const quantile = (p: number) => {
    if (!n) return null;
    const h = (n - 1) * p;
    const j = Math.floor(h);
    return sorted[j] + (h - j) * (sorted[Math.min(j + 1, n - 1)] - sorted[j]);
  };
  let mean = 0;
  let m2 = 0;
  sorted.forEach((value, index) => {
    const delta = value - mean;
    mean += delta / (index + 1);
    m2 += delta * (value - mean);
  });
  return {
    n_valid: n,
    n_missing: values.length - n,
    mean: n ? mean : null,
    sd: n > 1 ? Math.sqrt(m2 / (n - 1)) : null,
    median: quantile(0.5),
    q1: quantile(0.25),
    q3: quantile(0.75),
    min: sorted[0] ?? null,
    max: sorted[n - 1] ?? null,
  };
}

export function summarize(
  snapshot: Snapshot,
): (Description & { sample_id: string; indicator_id: string })[] {
  const seen = new Set<string>();
  for (const row of snapshot.rows) {
    const key = JSON.stringify([row.participant_code, row.sample_id]);
    if (seen.has(key))
      throw new Error("快照包含重复的评价员与样品记录，不能静默合并。");
    seen.add(key);
  }
  return snapshot.config.samples.flatMap((sample) =>
    snapshot.config.indicators.map((indicator) => ({
      sample_id: sample.sample_id,
      indicator_id: indicator.indicator_id,
      ...describe(
        snapshot.rows
          .filter((row) => row.sample_id === sample.sample_id)
          .map((row) => {
            const answers = row.answers.numeric.filter(
              (answer) => answer.indicator_id === indicator.indicator_id,
            );
            if (answers.length > 1) throw new Error("快照包含重复指标答案。");
            return answers[0]?.value ?? null;
          }),
      ),
    })),
  );
}
