import { describe as suite, expect, it } from "vitest";
import reference from "../docs/examples/statistics-reference.json";
import { describe, summarize } from "../src/features/analysis/statistics";
import config from "../docs/examples/experiment-valid.json";
import type { Snapshot } from "../src/domain/types";

suite("descriptive statistics", () => {
  it("uses sample SD, type 7 quantiles and retains valid zero", () => {
    expect(describe([0, null])).toEqual({
      n_valid: 1,
      n_missing: 1,
      mean: 0,
      sd: null,
      median: 0,
      q1: 0,
      q3: 0,
      min: 0,
      max: 0,
    });
    expect(describe([1, 2, 3, 4])).toEqual({
      n_valid: 4,
      n_missing: 0,
      mean: 2.5,
      sd: Math.sqrt(5 / 3),
      median: 2.5,
      q1: 1.75,
      q3: 3.25,
      min: 1,
      max: 4,
    });
    expect(describe([]).mean).toBeNull();
    expect(describe([null, null])).toMatchObject({
      n_valid: 0,
      n_missing: 2,
      sd: null,
      q1: null,
    });
    expect(describe([0, 0, 0])).toMatchObject({ mean: 0, sd: 0 });
    expect(() => describe([NaN])).toThrow();
  });
  it("matches the independently supplied reference fixture", () => {
    for (const id of reference.descriptive_case.sample_ids) {
      const result = describe(
        reference.descriptive_case.rows.map((row) => row[id as "s_a"]),
      );
      const expected = reference.descriptive_case.expected[id as "s_a"];
      for (const [key, value] of Object.entries(expected))
        expect(result[key as keyof typeof result]).toBeCloseTo(value, 10);
    }
  });
  it("counts only frozen submitted rows and never mutates the snapshot", () => {
    const snapshot = {
      snapshot_id: "s1",
      experiment_id: "e1",
      created_at: "2026-01-01T00:00:00Z",
      data_revision: 1,
      input_hash: "hash",
      config,
      rows: [
        {
          participant_code: "P001",
          sample_id: "s_a",
          response_id: "r1",
          revision_id: "v1",
          revision_no: 1,
          submitted_at: "2026-01-01T00:00:00Z",
          answers: {
            numeric: [
              { indicator_id: "color_depth", value: 0, missing_reason: null },
            ],
            text: [],
          },
        },
      ],
      coverage: [],
    } as unknown as Snapshot;
    const before = JSON.stringify(snapshot);
    const result = summarize(snapshot);
    expect(
      result.find(
        (row) => row.sample_id === "s_a" && row.indicator_id === "color_depth",
      ),
    ).toMatchObject({ mean: 0, n_valid: 1, n_missing: 0 });
    expect(
      result.find(
        (row) => row.sample_id === "s_b" && row.indicator_id === "color_depth",
      ),
    ).toMatchObject({ mean: null, n_valid: 0, n_missing: 0 });
    expect(JSON.stringify(snapshot)).toBe(before);
    snapshot.rows.push(structuredClone(snapshot.rows[0]));
    expect(() => summarize(snapshot)).toThrow(/重复/);
  });
});
