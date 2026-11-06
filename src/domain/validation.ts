import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schema from "../../docs/contracts/experiment-config.schema.json";
import type { Answers, ExperimentConfig, Indicator, Issue } from "./types";
import type { ErrorObject } from "ajv";

const fieldNames: Record<string, string> = {
  schema_version: "配置格式版本",
  experiment: "实验信息",
  samples: "样品列表",
  indicators: "指标列表",
  text_questions: "文字题列表",
  title: "实验名称",
  description: "说明",
  instructions: "填写说明",
  time_zone: "时区",
  opens_at: "开放时间",
  closes_at: "截止时间",
  display_sample_names: "显示样品名称选项",
  design: "实验设计",
  sample_order: "样品顺序",
  sample_id: "样品标识",
  code: "样品编码",
  admin_name: "管理名称",
  display_name: "显示名称",
  indicator_id: "指标标识",
  category: "指标大类",
  label: "名称",
  kind: "评分形式",
  min: "量程下限",
  max: "量程上限",
  step: "评分步长",
  required: "必答选项",
  allow_not_evaluable: "允许无法评价选项",
  direction: "评分方向",
  analysis_scale: "分析尺度",
  anchors: "档位列表",
  from: "档位下限",
  to: "档位上限",
  text_question_id: "文字题标识",
  max_length: "最大字数",
};
function fieldName(config: any, path: string): string {
  const parts = path.split("/").filter(Boolean);
  const last = parts.at(-1) ?? "";
  if (parts[0] === "indicators" && /^\d+$/.test(parts[1] ?? "")) {
    const indicator = config?.indicators?.[Number(parts[1])];
    const name =
      typeof indicator?.label === "string" && indicator.label.trim()
        ? `指标「${indicator.label}」`
        : `第${Number(parts[1]) + 1}个指标`;
    const anchorIndex = parts.indexOf("anchors");
    return (
      name +
      (anchorIndex >= 0 && /^\d+$/.test(parts[anchorIndex + 1] ?? "")
        ? `第${Number(parts[anchorIndex + 1]) + 1}档`
        : "") +
      (fieldNames[last] ?? "配置")
    );
  }
  if (parts[0] === "text_questions" && /^\d+$/.test(parts[1] ?? "")) {
    const label = config?.text_questions?.[Number(parts[1])]?.label;
    return (
      (typeof label === "string" && label.trim()
        ? `文字题「${label}」`
        : `第${Number(parts[1]) + 1}个文字题`) + (fieldNames[last] ?? "配置")
    );
  }
  if (parts[0] === "samples" && /^\d+$/.test(parts[1] ?? ""))
    return `第${Number(parts[1]) + 1}个样品` + (fieldNames[last] ?? "配置");
  return fieldNames[last] ?? "配置";
}
function schemaIssue(config: any, error: ErrorObject): Issue {
  const params = error.params as any;
  const path =
    error.instancePath +
    (error.keyword === "additionalProperties"
      ? "/" + params.additionalProperty
      : error.keyword === "required"
        ? "/" + params.missingProperty
        : "");
  const name = fieldName(config, path);
  const types: Record<string, string> = {
    object: "对象",
    array: "列表",
    string: "文字",
    number: "有限数值",
    integer: "整数",
    boolean: "是或否选项",
    null: "空值",
  };
  const expected: Record<string, string> = {
    schema_version: "1.0.0",
    time_zone: "上海时区",
    design: "完整被试内设计",
    sample_order: "固定顺序",
  };
  const options: Record<string, string> = {
    kind: "连续评分或档位评分",
    direction: "越高越好、越低越好或中性",
    analysis_scale: "等距尺度或顺序尺度",
  };
  const messages: Record<string, string> = {
    additionalProperties: `${name}含不支持的字段，请删除该字段。`,
    required: `请填写${name}。`,
    type: `${name}必须是${types[params.type] ?? "规定的数据类型"}。`,
    minLength: `${name}至少填写${params.limit}个字符，不能留空。`,
    maxLength: `${name}最多允许${params.limit}个字符。`,
    minItems: `${name}至少需要${params.limit}项。`,
    maxItems: `${name}最多允许${params.limit}项。`,
    minimum: `${name}不能小于${params.limit}。`,
    maximum: `${name}不能大于${params.limit}。`,
    exclusiveMinimum: `${name}必须大于${params.limit}。`,
    exclusiveMaximum: `${name}必须小于${params.limit}。`,
    pattern: `${name}须以小写字母开头，仅含小写字母、数字、下划线或短横线，最长64个字符。`,
    format: `${name}必须是包含时区的有效日期时间，例如2030-01-01T08:00:00+08:00。`,
    const: `${name}必须使用${expected[path.split("/").at(-1)!] ?? "当前版本规定的固定值"}。`,
    enum: `${name}请选择${options[path.split("/").at(-1)!] ?? "列表中的有效选项"}。`,
    anyOf: `${name}必须是合法数值或空值。`,
    if: `${name}与所选评分形式不匹配，请检查档位设置。`,
  };
  return {
    path,
    code:
      error.keyword === "additionalProperties"
        ? "UNKNOWN_FIELD"
        : error.keyword === "type"
          ? "INVALID_TYPE"
          : path === "/schema_version"
            ? "UNSUPPORTED_VERSION"
            : "SCHEMA_VALIDATION",
    message:
      messages[error.keyword] ??
      `${name}格式不合法，请检查字段类型、范围和必填项。`,
  };
}

function configMessage(config: any, path: string, code: string): string {
  const name = fieldName(config, path);
  const index = Number(path.split("/")[2]);
  const indicator = config?.indicators?.[index];
  if (code === "INVALID_RANGE") {
    const parts = path.split("/");
    const anchorIndex = parts.indexOf("anchors");
    const anchor =
      anchorIndex >= 0
        ? indicator?.anchors?.[Number(parts[anchorIndex + 1])]
        : undefined;
    return anchor
      ? `${name}的下限${anchor.from}必须小于上限${anchor.to}，请调整本档边界。`
      : `${name}的量程下限${indicator?.min}必须小于上限${indicator?.max}，请调整量程。`;
  }
  const messages: Record<string, string> = {
    DUPLICATE_ID: `${name}与其他条目标识重复，请使用唯一标识。`,
    DUPLICATE_CODE: `${name}与其他样品编码重复，去除首尾空格后也必须唯一。`,
    REQUIRED: `请填写${name}，不能只含空白。`,
    EMPTY_DISPLAY_NAME: `已开启显示样品名称，请填写${name}。`,
    INVALID_TIME_WINDOW: "截止时间必须晚于开放时间，请调整实验日程。",
    DECIMAL_PRECISION: `${name}最多保留两位有效小数，请检查原始数值。`,
    INVALID_RANGE: `${name}必须大于对应下限，请调整量程或档位边界。`,
    INVALID_STEP: `${name}必须从量程下限${indicator?.min}起按步长${indicator?.step}均匀划分，量程上限${indicator?.max}也必须落在网格上。`,
    ANCHOR_OVERLAP: `${name}与前一档重叠，请将本档下限设为前一档上限。`,
    ANCHOR_GAP: `${name}存在缺口，请让相邻档位边界相接，并完整覆盖量程上下限。`,
  };
  return messages[code] ?? `${name}不合法，请按该字段的填写说明修改。`;
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const formal = ajv.compile(schema);
const draftSchema: any = structuredClone(schema);
for (const definition of Object.values(draftSchema.$defs) as any[]) {
  for (const [name, property] of Object.entries(
    definition.properties ?? {},
  ) as [string, any][]) {
    if (property.type === "string" && !name.endsWith("_id"))
      delete property.minLength;
  }
}
draftSchema.properties.samples.minItems = 0;
draftSchema.properties.indicators.minItems = 0;
delete draftSchema.$defs.indicator.allOf;
for (const name of ["min", "max", "step"])
  draftSchema.$defs.indicator.properties[name] = {
    anyOf: [draftSchema.$defs.indicator.properties[name], { type: "null" }],
  };
draftSchema.$id += "/draft";
const draft = ajv.compile(draftSchema);

export function scaled(value: number | string): number | null {
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  const text = String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!match) return null;
  const exponent = Number(match[4] ?? 0);
  const decimalPlaces = (match[3]?.length ?? 0) - exponent;
  const digits = (match[2] + (match[3] ?? "")).replace(/^0+(?=\d)/, "");
  if (Math.abs(exponent) > 100) return null;
  let integer = BigInt(digits);
  if (decimalPlaces > 2) {
    const divisor = 10n ** BigInt(decimalPlaces - 2);
    if (integer % divisor !== 0n) return null;
    integer /= divisor;
  } else integer *= 10n ** BigInt(2 - decimalPlaces);
  const result = Number(integer) * (match[1] ? -1 : 1);
  return Number.isSafeInteger(result) ? result : null;
}

export function normalizeConfig(value: unknown): ExperimentConfig {
  const normalize = (item: any, key = ""): any => {
    if (typeof item === "string")
      return (
        key.endsWith("_id") || key === "code" ? item.trim() : item
      ).normalize("NFC");
    if (Array.isArray(item)) return item.map((i) => normalize(i));
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item).map(([k, v]) => [k, normalize(v, k)]),
      );
    return item;
  };
  return normalize(value);
}

function configuration(value: unknown, incomplete: boolean): Issue[] {
  const c: any = normalizeConfig(value);
  const checker = incomplete ? draft : formal;
  checker(c);
  const issues: Issue[] = (checker.errors ?? []).map((e) => schemaIssue(c, e));
  const issue = (
    path: string,
    code: string,
    message = configMessage(c, path, code),
  ) => issues.push({ path, code, message });
  if (!c || typeof c !== "object") return issues;
  const unique = (
    items: any[],
    field: string,
    path: string,
    code = "DUPLICATE_ID",
  ) => {
    const ids = new Set();
    for (const [i, item] of items.entries()) {
      if (incomplete && field === "code" && item?.[field] === "") continue;
      if (ids.has(item?.[field])) issue(`${path}/${i}/${field}`, code);
      ids.add(item?.[field]);
    }
  };
  for (const [field, id] of [
    ["samples", "sample_id"],
    ["indicators", "indicator_id"],
    ["text_questions", "text_question_id"],
  ])
    if (Array.isArray(c[field])) unique(c[field], id, "/" + field);
  if (Array.isArray(c.samples)) {
    unique(c.samples, "code", "/samples", "DUPLICATE_CODE");
    if (!incomplete)
      c.samples.forEach((s: any, i: number) => {
        for (const field of ["code", "admin_name"])
          if (typeof s?.[field] === "string" && !s[field].trim())
            issue(`/samples/${i}/${field}`, "REQUIRED");
        if (
          c.experiment?.display_sample_names &&
          (typeof s?.display_name !== "string" || !s.display_name.trim())
        )
          issue(`/samples/${i}/display_name`, "EMPTY_DISPLAY_NAME");
      });
  }
  if (
    !incomplete &&
    typeof c.experiment?.title === "string" &&
    !c.experiment.title.trim()
  )
    issue("/experiment/title", "REQUIRED");
  if (!incomplete && Array.isArray(c.text_questions))
    c.text_questions.forEach((question: any, i: number) => {
      if (typeof question?.label === "string" && !question.label.trim())
        issue(`/text_questions/${i}/label`, "REQUIRED");
    });
  const e = c.experiment;
  if (
    !incomplete &&
    e?.opens_at &&
    e?.closes_at &&
    Date.parse(e.opens_at) >= Date.parse(e.closes_at)
  )
    issue("/experiment/closes_at", "INVALID_TIME_WINDOW");
  if (Array.isArray(c.indicators))
    c.indicators.forEach((ind: any, i: number) => {
      if (!ind || typeof ind !== "object") return;
      const path = `/indicators/${i}`;
      for (const name of ["min", "max", "step"])
        if (typeof ind[name] === "number" && scaled(ind[name]) === null)
          issue(`${path}/${name}`, "DECIMAL_PRECISION");
      const min = scaled(ind.min),
        max = scaled(ind.max),
        step = scaled(ind.step);
      if (!incomplete && min !== null && max !== null && step !== null) {
        if (min >= max) issue(path + "/max", "INVALID_RANGE");
        else if (step <= 0 || (max - min) % step !== 0)
          issue(path + "/step", "INVALID_STEP");
      }
      if (!incomplete)
        for (const name of ["category", "label"])
          if (typeof ind[name] === "string" && !ind[name].trim())
            issue(path + "/" + name, "REQUIRED");
      if (Array.isArray(ind.anchors))
        ind.anchors.forEach((a: any, j: number) => {
          if (!a || typeof a !== "object") return;
          if (!incomplete && typeof a.label === "string" && !a.label.trim())
            issue(`${path}/anchors/${j}/label`, "REQUIRED");
          for (const name of ["from", "to"])
            if (typeof a[name] === "number" && scaled(a[name]) === null)
              issue(`${path}/anchors/${j}/${name}`, "DECIMAL_PRECISION");
          if (incomplete) return;
          const from = scaled(a.from),
            to = scaled(a.to),
            prev = j ? scaled(ind.anchors[j - 1]?.to) : min;
          if (from !== null && prev !== null && from !== prev)
            issue(
              `${path}/anchors/${j}/from`,
              from < prev ? "ANCHOR_OVERLAP" : "ANCHOR_GAP",
            );
          if (from !== null && to !== null && from >= to)
            issue(`${path}/anchors/${j}`, "INVALID_RANGE");
          if (j === ind.anchors.length - 1 && to !== max)
            issue(`${path}/anchors/${j}/to`, "ANCHOR_GAP");
          if (
            min !== null &&
            step !== null &&
            step > 0 &&
            [from, to].some((v) => v !== null && (v - min) % step !== 0)
          )
            issue(`${path}/anchors/${j}`, "INVALID_STEP");
        });
    });
  return issues;
}
export const validateConfig = (value: unknown) => configuration(value, false);
export const validateDraftConfig = (value: unknown) =>
  configuration(value, true);

export function anchorFor(indicator: Indicator, value: number) {
  const score = scaled(value);
  if (score === null) return undefined;
  return indicator.anchors.find(
    (a, i) =>
      score >= scaled(a.from)! &&
      (score < scaled(a.to)! ||
        (i === indicator.anchors.length - 1 && score === scaled(a.to))),
  );
}

export function validateAnswers(
  config: ExperimentConfig,
  answers: Answers,
  complete: boolean,
): Issue[] {
  const issues: Issue[] = [];
  const answerMessage = (path: string, code: string): string => {
    const parts = path.split("/");
    const kind = parts[1];
    const answer = (answers as any)?.[kind]?.[Number(parts[2])];
    const definition =
      kind === "numeric"
        ? config.indicators.find((i) => i.indicator_id === answer?.indicator_id)
        : config.text_questions.find(
            (t) => t.text_question_id === answer?.text_question_id,
          );
    const name = definition
      ? `「${definition.label}」`
      : kind === "numeric"
        ? "数值答案"
        : kind === "text"
          ? "文字答案"
          : "答卷";
    const indicator =
      kind === "numeric" ? (definition as Indicator | undefined) : undefined;
    const grid = indicator
      ? `请填写${indicator.min}至${indicator.max}之间、从${indicator.min}起步长为${indicator.step}的分数。`
      : "";
    const messages: Record<string, string> = {
      UNKNOWN_FIELD: `${name}含不支持的字段，请删除该字段。`,
      INVALID_TYPE: `${name}${parts.at(-1) === "missing_reason" ? "的无法评价原因必须是文字或空值。" : kind === "numeric" ? "必须填写有限数值或选择无法评价。" : "必须填写文字。"}`,
      DUPLICATE_ID: `${name}重复出现，请对每个题目只填写一份答案。`,
      UNKNOWN_ID: `${name}引用的题目标识不存在，请按当前实验配置填写。`,
      INVALID_MISSING_REASON: `${name}有分数时原因须为空；选择允许的无法评价时，请填写1至2000字原因。`,
      REQUIRED: indicator
        ? `${name}为必答题。${grid}${indicator.allow_not_evaluable ? "也可以选择无法评价并填写原因。" : ""}`
        : `${name}为必答题，请填写文字，不能只含空白。`,
      DECIMAL_PRECISION: `${name}最多保留两位有效小数。${grid}`,
      INVALID_RANGE: `${name}超出允许量程。${grid}`,
      INVALID_STEP: `${name}未落在评分网格上。${grid}`,
      MAX_LENGTH: `${name}最多填写${definition && "max_length" in definition ? definition.max_length : 2000}个字符，请缩短答案。`,
    };
    return messages[code] ?? `${name}格式不合法，请按题目要求修改。`;
  };
  const issue = (
    path: string,
    code: string,
    message = answerMessage(path, code),
  ) => issues.push({ path, code, message });
  if (
    !answers ||
    typeof answers !== "object" ||
    !Array.isArray(answers.numeric) ||
    !Array.isArray(answers.text)
  )
    return [
      {
        path: "/",
        code: "INVALID_TYPE",
        message: "答案必须包含数值与文字数组",
      },
    ];
  for (const key of Object.keys(answers))
    if (!["numeric", "text"].includes(key)) issue("/" + key, "UNKNOWN_FIELD");
  for (const kind of ["numeric", "text"] as const) {
    const definitions =
      kind === "numeric" ? config.indicators : config.text_questions;
    const id = kind === "numeric" ? "indicator_id" : "text_question_id";
    const seen = new Set<string>();
    answers[kind].forEach((a: any, i) => {
      const path = `/${kind}/${i}`;
      if (!a || typeof a !== "object") {
        issue(path, "INVALID_TYPE");
        return;
      }
      for (const key of Object.keys(a))
        if (
          ![
            id,
            "value",
            ...(kind === "numeric" ? ["missing_reason"] : []),
          ].includes(key)
        )
          issue(path + "/" + key, "UNKNOWN_FIELD");
      if (seen.has(a[id])) issue(path + "/" + id, "DUPLICATE_ID");
      seen.add(a[id]);
      const d: any = definitions.find((x: any) => x[id] === a[id]);
      if (!d) {
        issue(path + "/" + id, "UNKNOWN_ID");
        return;
      }
      if (kind === "numeric") {
        if (a.value === null) {
          if (a.missing_reason !== null && typeof a.missing_reason !== "string")
            issue(path + "/missing_reason", "INVALID_TYPE");
          else if (
            a.missing_reason !== null &&
            (!d.allow_not_evaluable ||
              !a.missing_reason.trim() ||
              [...a.missing_reason].length > 2000)
          )
            issue(path + "/missing_reason", "INVALID_MISSING_REASON");
          if (
            complete &&
            d.required &&
            (!d.allow_not_evaluable || !a.missing_reason?.trim())
          )
            issue(path + "/value", "REQUIRED");
        } else if (typeof a.value !== "number" || !Number.isFinite(a.value))
          issue(path + "/value", "INVALID_TYPE");
        else {
          const value = scaled(a.value),
            min = scaled(d.min)!,
            max = scaled(d.max)!,
            step = scaled(d.step)!;
          if (value === null) issue(path + "/value", "DECIMAL_PRECISION");
          else if (value < min || value > max)
            issue(path + "/value", "INVALID_RANGE");
          else if (step <= 0 || (value - min) % step !== 0)
            issue(path + "/value", "INVALID_STEP");
          if (a.missing_reason !== null)
            issue(path + "/missing_reason", "INVALID_MISSING_REASON");
        }
      } else if (typeof a.value !== "string")
        issue(path + "/value", "INVALID_TYPE");
      else if ([...a.value].length > d.max_length)
        issue(path + "/value", "MAX_LENGTH");
      else if (complete && d.required && !a.value.trim())
        issue(path + "/value", "REQUIRED");
    });
    if (complete)
      for (const d of definitions as any[])
        if (!seen.has(d[id]))
          issue(
            "/" + kind,
            "MISSING_ANSWER",
            kind === "numeric"
              ? `缺少指标「${d.label}」的答案。请填写${d.min}至${d.max}之间、从${d.min}起步长为${d.step}的分数；选填题留空也需明确记录空值。`
              : `缺少文字题「${d.label}」的答案。请补充该题，最多${d.max_length}个字符；选填题可填写空文字。`,
          );
  }
  return issues;
}
