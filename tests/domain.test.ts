import { describe, expect, it } from "vitest";
import valid from "../docs/examples/experiment-valid.json";
import decimal from "../docs/examples/decimal-grid-valid.json";
import invalid from "../docs/examples/invalid-cases.json";
import {
  anchorFor,
  normalizeConfig,
  scaled,
  validateAnswers,
  validateConfig,
  validateDraftConfig,
} from "../src/domain/validation";
import { canonical, sha256 } from "../src/domain/hash";

describe("configuration contract", () => {
  it("hashes canonical JSON with standard SHA256 test vectors", () => {
    expect(sha256("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(canonical({ z: 1, a: [2, 3] })).toBe('{"a":[2,3],"z":1}');
  });
  it("accepts formal examples and precise decimal grids", () => {
    expect(validateConfig(valid)).toEqual([]);
    expect(validateConfig(decimal)).toEqual([]);
    expect(
      ["0.29", "0.36", "0.43", "0.50", "0.57", "0.5700"].map(scaled),
    ).toEqual([29, 36, 43, 50, 57, 57]);
    expect(scaled(0.291)).toBeNull();
    expect(scaled(1e-7)).toBeNull();
  });
  for (const item of invalid.cases)
    it(`rejects ${item.case_id}`, () => {
      const config: any = structuredClone(valid);
      for (const change of item.changes) {
        const parts = change.path.slice(1).split("/");
        let target = config;
        for (const p of parts.slice(0, -1)) target = target[p];
        target[parts.at(-1)!] = change.value;
      }
      expect(validateConfig(config).map((i) => i.code)).toContain(
        item.expected_error_code,
      );
    });
  it("keeps incomplete structural drafts while rejecting malformed ones", () => {
    const config: any = structuredClone(valid);
    config.experiment.title = "";
    config.samples = [];
    config.indicators[0].min = null;
    expect(validateDraftConfig(config)).toEqual([]);
    expect(validateConfig(config).length).toBeGreaterThan(0);
    config.indicators[0].indicator_id = "";
    expect(validateDraftConfig(config).length).toBeGreaterThan(0);
  });
  it("allows multiple empty sample codes in drafts but rejects duplicate nonempty codes", () => {
    const config = structuredClone(valid);
    config.samples[0].code = "";
    config.samples[1].code = "  ";
    expect(validateDraftConfig(config)).toEqual([]);
    expect(validateConfig(config).length).toBeGreaterThan(0);
    config.samples[0].code = " 001 ";
    config.samples[1].code = "001";
    expect(validateDraftConfig(config).map((i) => i.code)).toContain(
      "DUPLICATE_CODE",
    );
  });
  it("explains schema and semantic configuration failures in Chinese", () => {
    const config: any = structuredClone(valid);
    delete config.experiment.title;
    config.experiment.description = 9;
    config.samples[0].code = "";
    config.indicators[1].step = 0.3;
    config.extra = true;
    const issues = validateConfig(config);
    expect(
      issues.every(
        (i) =>
          /[\u4e00-\u9fff]/.test(i.message) &&
          !/(must |should |property|schema|配置不符合约束)/i.test(i.message),
      ),
    ).toBe(true);
    expect(
      issues.find((i) => i.path === "/experiment/title")?.message,
    ).toContain("实验名称");
    expect(issues.find((i) => i.code === "INVALID_STEP")?.message).toContain(
      String(config.indicators[1].step),
    );
    expect(issues.find((i) => i.code === "INVALID_STEP")?.message).toContain(
      config.indicators[1].label,
    );
    config.indicators[1].min = 11;
    expect(
      validateConfig(config).find((i) => i.code === "INVALID_RANGE")?.message,
    ).toMatch(/11.*10/);
  });
  it("normalizes identifiers and uses half-open anchor boundaries", () => {
    const config = normalizeConfig(valid);
    expect(anchorFor(config.indicators[0], 4)?.label).toBe(
      config.indicators[0].anchors[1].label,
    );
    expect(anchorFor(config.indicators[0], 10)?.label).toBe(
      config.indicators[0].anchors.at(-1)?.label,
    );
  });
  it("returns issues rather than throwing for structurally hostile input", () => {
    for (const config of [
      null,
      {},
      [],
      { ...valid, samples: [null, 2] },
      { ...valid, indicators: [null, {}] },
      { ...valid, experiment: { ...valid.experiment, title: 1 } },
    ])
      expect(validateConfig(config).length).toBeGreaterThan(0);
  });
  it("rejects whitespace-only question and anchor names at publication", () => {
    const config = structuredClone(valid);
    config.text_questions[0].label = "  ";
    config.indicators[0].anchors[0].label = "\t";
    expect(
      validateConfig(config).filter((i) => i.code === "REQUIRED"),
    ).toHaveLength(2);
  });
});

describe("answers contract", () => {
  const config = normalizeConfig(decimal);
  it("accepts zero and distinguishes missing values, wrong grid and precision", () => {
    const answer = (
      value: number | null,
      missing_reason: string | null = null,
    ) => ({
      numeric: [
        {
          indicator_id: config.indicators[0].indicator_id,
          value,
          missing_reason,
        },
      ],
      text: [],
    });
    expect(validateAnswers(config, answer(0.36), true)).toEqual([]);
    expect(
      validateAnswers(config, answer(0.3), true).map((i) => i.code),
    ).toContain("INVALID_STEP");
    expect(
      validateAnswers(config, answer(0.291), true).map((i) => i.code),
    ).toContain("DECIMAL_PRECISION");
    expect(validateAnswers(config, answer(null), true).length).toBeGreaterThan(
      0,
    );
    expect(validateAnswers(config, { numeric: [], text: [] }, false)).toEqual(
      [],
    );
    expect(
      validateAnswers(config, { numeric: [], text: [] }, true).length,
    ).toBeGreaterThan(0);
  });
  it("rejects unknown and duplicate question IDs and counts Unicode code points", () => {
    const c = normalizeConfig(valid);
    c.text_questions = [
      {
        text_question_id: "t",
        label: "题",
        description: "",
        required: true,
        max_length: 2,
      },
    ];
    expect(
      validateAnswers(
        c,
        { numeric: [], text: [{ text_question_id: "t", value: "😀😀" }] },
        false,
      ),
    ).toEqual([]);
    expect(
      validateAnswers(
        c,
        { numeric: [], text: [{ text_question_id: "t", value: "😀😀😀" }] },
        false,
      ).length,
    ).toBe(1);
    expect(
      validateAnswers(
        c,
        { numeric: [], text: [{ text_question_id: "x", value: "" }] },
        false,
      ).map((i) => i.code),
    ).toContain("UNKNOWN_ID");
    expect(
      validateAnswers(
        c,
        {
          numeric: [],
          text: [
            { text_question_id: "t", value: "" },
            { text_question_id: "t", value: "" },
          ],
        },
        false,
      ).map((i) => i.code),
    ).toContain("DUPLICATE_ID");
  });
  it("gives answer errors the question name and actionable limits", () => {
    const c = normalizeConfig(decimal);
    c.indicators[0].label = "甜味强度";
    c.text_questions = [
      {
        text_question_id: "t",
        label: "口感建议",
        description: "",
        required: true,
        max_length: 2,
      },
    ];
    const issues = validateAnswers(
      c,
      {
        numeric: [
          {
            indicator_id: c.indicators[0].indicator_id,
            value: 0.3,
            missing_reason: null,
          },
        ],
        text: [{ text_question_id: "t", value: "太甜了" }],
      },
      true,
    );
    expect(issues.find((i) => i.code === "INVALID_STEP")?.message).toMatch(
      /甜味强度.*0\.29.*0\.57.*0\.07/,
    );
    expect(issues.find((i) => i.code === "MAX_LENGTH")?.message).toMatch(
      /口感建议.*2/,
    );
    const missing = validateAnswers(c, { numeric: [], text: [] }, true);
    expect(missing.some((i) => i.message.includes("甜味强度"))).toBe(true);
    expect(missing.some((i) => i.message.includes("口感建议"))).toBe(true);
  });
});
