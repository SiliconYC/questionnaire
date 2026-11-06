import { useState, useEffect, useRef } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Plus,
  ArrowRight,
  ArrowLeft,
  Trash2,
  ArrowUp,
  ArrowDown,
  Eye,
  Save,
  Upload,
  Download,
  Check,
} from "lucide-react";
import example from "../../docs/examples/experiment-valid.json";
import type { ExperimentConfig, Indicator, Issue } from "../domain/types";
import { validateConfig } from "../domain/validation";
import { useApp } from "./context";
import { PageTitle, ErrorBox, Badge, Dialog } from "./components";
export function ConfigPreview({ config }: { config: ExperimentConfig }) {
  return (
    <div className="preview-sheet">
      <span className="eyebrow">评价员视角预览</span>
      <h2>{config.experiment.title || "未命名实验"}</h2>
      <p className="pre-wrap">
        {config.experiment.instructions || "尚未填写说明"}
      </p>
      <div className="sample-chips">
        {config.samples.map((s) => (
          <span key={s.sample_id}>
            样品 {s.code}
            {config.experiment.display_sample_names && " · " + s.display_name}
          </span>
        ))}
      </div>
      {config.indicators.map((i) => (
        <div className="preview-question" key={i.indicator_id}>
          <strong>
            {i.label || "未命名指标"}
            {i.required ? " *" : ""}
          </strong>
          <p>{i.description}</p>
          <div className="range-preview">
            <span>{i.min}</span>
            <div />
            <span>{i.max}</span>
          </div>
          <small>
            初始为空 · 步长 {i.step} ·{" "}
            {i.analysis_scale === "ordinal" ? "有序等级评分" : "等距评分"}
          </small>
          {i.anchors.map((a, k) => (
            <p key={k}>
              {a.from} ≤ 分数 {k === i.anchors.length - 1 ? "≤" : "<"} {a.to}：
              {a.label}
            </p>
          ))}
        </div>
      ))}
      {config.text_questions.map((q) => (
        <div className="preview-question" key={q.text_question_id}>
          <strong>
            {q.label}
            {q.required ? " *" : ""}
          </strong>
          <p>{q.description}</p>
          <div className="mock-textarea">
            请输入你的感受（最多 {q.max_length} 字）
          </div>
        </div>
      ))}
    </div>
  );
}
export function Editor() {
  const { experimentId } = useParams(),
    { data, mutate, setNotice } = useApp(),
    navigate = useNavigate();
  const experiment = data.experiments.find(
    (e) => e.experiment_id === experimentId,
  );
  const [config, setConfig] = useState<ExperimentConfig>(() =>
    experiment
      ? structuredClone(experiment.config)
      : {
          ...(structuredClone(example) as ExperimentConfig),
          experiment: {
            ...example.experiment,
            title: "",
            description: "",
            instructions: "",
            time_zone: "Asia/Shanghai",
            design: "within_subject_complete",
            sample_order: "fixed",
          },
          samples: [],
          indicators: [],
          text_questions: [],
        },
  );
  const [step, setStep] = useState(0),
    [error, setError] = useState(""),
    [issues, setIssues] = useState<Issue[]>([]),
    [busy, setBusy] = useState(false),
    [importConfig, setImportConfig] = useState<ExperimentConfig | null>(null),
    [publishing, setPublishing] = useState(false);
  const [working, setWorking] = useState(false),
    [cancel, setCancel] = useState<AbortController | null>(null);
  const initialVersion = useRef(experiment?.edit_version ?? 0),
    persistedId = useRef(experimentId);
  const steps = ["基本信息", "样品配置", "数值指标", "文字题", "预览发布"];
  function change(fn: (c: ExperimentConfig) => void) {
    setConfig((c) => {
      const n = structuredClone(c);
      fn(n);
      return n;
    });
  }
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);
  async function save(publish = false) {
    setError("");
    setBusy(true);
    try {
      if (publish) {
        const errs = validateConfig(config);
        setIssues(errs);
        if (errs.length) return;
      }
      const saved = await mutate(
        persistedId.current ? "updateDraft" : "createDraft",
        persistedId.current
          ? {
              experiment_id: persistedId.current,
              config,
              expected_version: initialVersion.current,
            }
          : { config },
      );
      persistedId.current = saved.experiment_id;
      initialVersion.current = saved.edit_version;
      if (publish)
        await mutate("publish", {
          experiment_id: saved.experiment_id,
          expected_version: saved.edit_version,
        });
      setNotice(
        publish
          ? "实验已发布，配置已锁定。现在可以分配评价员。"
          : "实验草稿已保存。",
      );
      navigate("/admin/experiments/" + saved.experiment_id);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function importFile(file: File) {
    const ctl = new AbortController();
    setCancel(ctl);
    setWorking(true);
    setError("");
    try {
      const { parseImport } = await import("../features/files");
      const result = await parseImport(file, ctl.signal);
      setIssues(result.issues);
      if (result.config) setImportConfig(result.config);
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking(false);
      setCancel(null);
    }
  }
  if (experiment && experiment.status !== "draft")
    return (
      <ErrorBox message="已发布的配置不可修改，请返回工作台复制为新实验。" />
    );
  return (
    <>
      <PageTitle
        eyebrow="EXPERIMENT DESIGN"
        title={experiment ? "编辑实验草稿" : "创建新实验"}
        description="把研究问题变成清晰的样品与量表。草稿可以随时保存。"
        actions={
          <Link className="button" to="/admin">
            <ArrowLeft size={16} />
            返回实验
          </Link>
        }
      />
      <div className="editor-layout">
        <aside className="editor-steps">
          {steps.map((s, k) => (
            <button
              key={s}
              className={step === k ? "selected" : ""}
              onClick={() => setStep(k)}
            >
              <span>{k + 1}</span>
              {s}
            </button>
          ))}
          <div className="editor-help">
            <strong>已有实验配置？</strong>
            <p>支持正式 JSON 与 Excel 五表模板。</p>
            <label className="button">
              <Upload size={16} />
              导入配置
              <input
                type="file"
                accept=".json,.xlsx"
                className="sr-only"
                disabled={working}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importFile(f);
                  e.target.value = "";
                }}
              />
            </label>
            <button
              onClick={async () => {
                try {
                  await (await import("../features/files")).downloadTemplate();
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              <Download size={16} />
              下载 Excel 模板
            </button>
            <button
              onClick={() => {
                setConfig(structuredClone(example) as ExperimentConfig);
                setIssues([]);
              }}
            >
              填入示例配置
            </button>
          </div>
        </aside>
        <section className="panel editor-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">STEP 0{step + 1}</span>
              <h2>{steps[step]}</h2>
            </div>
            <Badge status="draft" />
          </div>
          <ErrorBox message={error} />
          {working && (
            <div className="info-box" role="status">
              正在校验文件…<button onClick={() => cancel?.abort()}>取消</button>
            </div>
          )}
          {issues.length > 0 && (
            <div className="error-box" role="alert">
              <strong>请检查以下 {issues.length} 项</strong>
              <ul>
                {issues.map((i, k) => (
                  <li key={k}>
                    {i.sheet && i.sheet + " " + i.cell} {i.path}：{i.message}
                  </li>
                ))}
              </ul>
              <button
                onClick={async () => {
                  (await import("../features/files")).downloadIssues(issues);
                }}
              >
                下载错误清单
              </button>
            </div>
          )}
          {step === 0 && (
            <>
              <label className="field">
                实验名称 *
                <input
                  maxLength={100}
                  placeholder="例如：烘焙配方感官评价"
                  value={config.experiment.title}
                  onChange={(e) =>
                    change((c) => {
                      c.experiment.title = e.target.value;
                    })
                  }
                />
              </label>
              <label className="field">
                实验说明
                <textarea
                  rows={3}
                  maxLength={2000}
                  placeholder="描述实验背景和评价目的"
                  value={config.experiment.description}
                  onChange={(e) =>
                    change((c) => {
                      c.experiment.description = e.target.value;
                    })
                  }
                />
              </label>
              <label className="field">
                填写与品尝说明
                <textarea
                  rows={4}
                  maxLength={4000}
                  placeholder="说明品尝方式、注意事项和评分原则"
                  value={config.experiment.instructions}
                  onChange={(e) =>
                    change((c) => {
                      c.experiment.instructions = e.target.value;
                    })
                  }
                />
              </label>
              <div className="two-col">
                {(["opens_at", "closes_at"] as const).map((key, k) => (
                  <label className="field" key={key}>
                    {k ? "截止时间" : "开放时间"}（上海时间）
                    <input
                      type="datetime-local"
                      value={
                        config.experiment[key]
                          ? new Date(
                              new Date(config.experiment[key]!).getTime() +
                                8 * 3600000,
                            )
                              .toISOString()
                              .slice(0, 16)
                          : ""
                      }
                      onChange={(e) =>
                        change((c) => {
                          c.experiment[key] = e.target.value
                            ? new Date(
                                e.target.value + ":00+08:00",
                              ).toISOString()
                            : null;
                        })
                      }
                    />
                  </label>
                ))}
              </div>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={config.experiment.display_sample_names}
                  onChange={(e) =>
                    change((c) => {
                      c.experiment.display_sample_names = e.target.checked;
                    })
                  }
                />
                向评价员显示样品公开名称
              </label>
              <p className="muted">
                默认只显示样品编码。样品按固定建议顺序呈送；本版本不随机化顺序。
              </p>
            </>
          )}
          {step === 1 && (
            <>
              <p className="muted">
                设置 2–12 个样品。编码作为文本保存，保留 001 这样的前导零。
              </p>
              {config.samples.map((s, k) => (
                <div className="edit-card" key={s.sample_id}>
                  <div className="row spread">
                    <strong>样品 {String(k + 1).padStart(2, "0")}</strong>
                    <div className="actions">
                      <button
                        className="icon-button"
                        aria-label={"上移样品 " + s.code}
                        disabled={k === 0}
                        onClick={() =>
                          change((c) => {
                            [c.samples[k - 1], c.samples[k]] = [
                              c.samples[k],
                              c.samples[k - 1],
                            ];
                          })
                        }
                      >
                        <ArrowUp size={16} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={"下移样品 " + s.code}
                        disabled={k === config.samples.length - 1}
                        onClick={() =>
                          change((c) => {
                            [c.samples[k + 1], c.samples[k]] = [
                              c.samples[k],
                              c.samples[k + 1],
                            ];
                          })
                        }
                      >
                        <ArrowDown size={16} />
                      </button>
                      <button
                        className="icon-button danger-text"
                        aria-label={"删除样品 " + s.code}
                        onClick={() =>
                          change((c) => {
                            c.samples.splice(k, 1);
                          })
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="two-col">
                    <label className="field">
                      样品编码 *
                      <input
                        maxLength={32}
                        value={s.code}
                        onChange={(e) =>
                          change((c) => {
                            c.samples[k].code = e.target.value;
                          })
                        }
                      />
                    </label>
                    <label className="field">
                      管理名称 *
                      <input
                        maxLength={100}
                        value={s.admin_name}
                        onChange={(e) =>
                          change((c) => {
                            c.samples[k].admin_name = e.target.value;
                          })
                        }
                      />
                    </label>
                  </div>
                  <label className="field">
                    公开名称
                    <input
                      maxLength={100}
                      value={s.display_name}
                      onChange={(e) =>
                        change((c) => {
                          c.samples[k].display_name = e.target.value;
                        })
                      }
                    />
                  </label>
                  <small className="muted">稳定 ID：{s.sample_id}</small>
                </div>
              ))}
              <button
                disabled={config.samples.length >= 12}
                onClick={() =>
                  change((c) => {
                    c.samples.push({
                      sample_id: "s_" + crypto.randomUUID().slice(0, 8),
                      code: "",
                      admin_name: "",
                      display_name: "",
                    });
                  })
                }
              >
                <Plus size={16} />
                添加样品（{config.samples.length}/12）
              </button>
            </>
          )}
          {step === 2 && (
            <>
              <p className="muted">
                数值支持最多两位小数。量程、步长与档位在发布后锁定。
              </p>
              {config.indicators.map((i, k) => (
                <IndicatorEditor
                  key={i.indicator_id}
                  indicator={i}
                  onChange={(n) =>
                    change((c) => {
                      c.indicators[k] = n;
                    })
                  }
                  onDelete={() =>
                    change((c) => {
                      c.indicators.splice(k, 1);
                    })
                  }
                />
              ))}
              <button
                disabled={config.indicators.length >= 30}
                onClick={() =>
                  change((c) => {
                    c.indicators.push({
                      indicator_id: "i_" + crypto.randomUUID().slice(0, 8),
                      category: "综合感受",
                      label: "",
                      description: "",
                      kind: "continuous",
                      min: 0,
                      max: 10,
                      step: 1,
                      required: true,
                      allow_not_evaluable: false,
                      direction: "neutral",
                      analysis_scale: "interval",
                      anchors: [],
                    });
                  })
                }
              >
                <Plus size={16} />
                添加数值指标（{config.indicators.length}/30）
              </button>
            </>
          )}
          {step === 3 && (
            <>
              <p className="muted">
                文字题对每个样品重复展示，原话将保留在结果中。
              </p>
              {config.text_questions.map((q, k) => (
                <div className="edit-card" key={q.text_question_id}>
                  <div className="row spread">
                    <h3>文字题 {k + 1}</h3>
                    <button
                      className="icon-button danger-text"
                      aria-label={"删除文字题 " + (k + 1)}
                      onClick={() =>
                        change((c) => {
                          c.text_questions.splice(k, 1);
                        })
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <label className="field">
                    题目
                    <input
                      maxLength={100}
                      value={q.label}
                      onChange={(e) =>
                        change((c) => {
                          c.text_questions[k].label = e.target.value;
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    说明
                    <textarea
                      maxLength={2000}
                      value={q.description}
                      onChange={(e) =>
                        change((c) => {
                          c.text_questions[k].description = e.target.value;
                        })
                      }
                    />
                  </label>
                  <div className="two-col">
                    <label className="field">
                      字符上限
                      <input
                        type="number"
                        min={1}
                        max={2000}
                        value={q.max_length}
                        onChange={(e) =>
                          change((c) => {
                            c.text_questions[k].max_length = Number(
                              e.target.value,
                            );
                          })
                        }
                      />
                    </label>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={q.required}
                        onChange={(e) =>
                          change((c) => {
                            c.text_questions[k].required = e.target.checked;
                          })
                        }
                      />
                      必答
                    </label>
                  </div>
                </div>
              ))}
              <button
                disabled={config.text_questions.length >= 10}
                onClick={() =>
                  change((c) => {
                    c.text_questions.push({
                      text_question_id: "q_" + crypto.randomUUID().slice(0, 8),
                      label: "",
                      description: "",
                      required: false,
                      max_length: 500,
                    });
                  })
                }
              >
                <Plus size={16} />
                添加文字题（{config.text_questions.length}/10）
              </button>
            </>
          )}
          {step === 4 && (
            <>
              <div className="info-box">
                发布后题目、样品、量程及日程将锁定。后续调整请复制为新实验。
              </div>
              <ConfigPreview config={config} />
            </>
          )}
          <div className="editor-footer">
            <button disabled={busy} onClick={() => void save()}>
              <Save size={16} />
              保存草稿
            </button>
            <div className="actions">
              {step > 0 && (
                <button onClick={() => setStep(step - 1)}>上一步</button>
              )}
              {step < 4 ? (
                <button className="primary" onClick={() => setStep(step + 1)}>
                  下一步 <ArrowRight size={16} />
                </button>
              ) : (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => {
                    setIssues(validateConfig(config));
                    if (!validateConfig(config).length) setPublishing(true);
                  }}
                >
                  发布实验
                </button>
              )}
            </div>
          </div>
        </section>
      </div>
      {importConfig && (
        <Dialog title="确认导入配置" onClose={() => setImportConfig(null)}>
          <p>
            校验通过。导入只替换当前编辑内容，点击保存后才创建草稿，不会覆盖已发布实验。
          </p>
          <p>
            <strong>{importConfig.experiment.title}</strong> ·{" "}
            {importConfig.samples.length} 个样品 ·{" "}
            {importConfig.indicators.length} 个指标 ·{" "}
            {importConfig.text_questions.length} 个文字题
          </p>
          <div className="dialog-actions">
            <button onClick={() => setImportConfig(null)}>取消</button>
            <button
              className="primary"
              onClick={() => {
                setConfig(importConfig);
                setImportConfig(null);
                setStep(4);
              }}
            >
              确认使用此配置
            </button>
          </div>
        </Dialog>
      )}
      {publishing && (
        <Dialog
          title="发布并锁定实验配置？"
          onClose={() => setPublishing(false)}
        >
          <p>
            评价员会看到固定样品顺序。发布后不能直接修改题目、量程与日程；新一轮实验请复制创建。
          </p>
          <div className="dialog-actions">
            <button onClick={() => setPublishing(false)}>继续编辑</button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void save(true)}
            >
              <Check size={16} />
              确认发布
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
function IndicatorEditor({
  indicator: i,
  onChange,
  onDelete,
}: {
  indicator: Indicator;
  onChange: (i: Indicator) => void;
  onDelete: () => void;
}) {
  function edit<K extends keyof Indicator>(key: K, value: Indicator[K]) {
    onChange({ ...i, [key]: value });
  }
  return (
    <div className="edit-card">
      <div className="row spread">
        <h3>{i.label || "新评分指标"}</h3>
        <button
          className="icon-button danger-text"
          aria-label={"删除指标 " + i.label}
          onClick={onDelete}
        >
          <Trash2 size={16} />
        </button>
      </div>
      <div className="two-col">
        <label className="field">
          大类
          <input
            value={i.category}
            maxLength={50}
            onChange={(e) => edit("category", e.target.value)}
          />
        </label>
        <label className="field">
          指标名称
          <input
            value={i.label}
            maxLength={100}
            onChange={(e) => edit("label", e.target.value)}
          />
        </label>
      </div>
      <label className="field">
        指标说明
        <textarea
          maxLength={2000}
          value={i.description}
          onChange={(e) => edit("description", e.target.value)}
        />
      </label>
      <div className="three-col">
        {(["min", "max", "step"] as const).map((key, k) => (
          <label className="field" key={key}>
            {["量程下限", "量程上限", "步长"][k]}
            <input
              type="number"
              step="any"
              value={i[key] ?? ""}
              onChange={(e) =>
                edit(
                  key,
                  e.target.value === ""
                    ? (null as unknown as number)
                    : Number(e.target.value),
                )
              }
            />
          </label>
        ))}
      </div>
      <div className="two-col">
        <label className="field">
          形式
          <select
            value={i.kind}
            onChange={(e) =>
              onChange({
                ...i,
                kind: e.target.value as Indicator["kind"],
                anchors:
                  e.target.value === "anchored"
                    ? [
                        { label: "较低", from: i.min, to: (i.min + i.max) / 2 },
                        { label: "较高", from: (i.min + i.max) / 2, to: i.max },
                      ]
                    : [],
              })
            }
          >
            <option value="continuous">连续评分</option>
            <option value="anchored">带档位说明</option>
          </select>
        </label>
        <label className="field">
          分析尺度
          <select
            value={i.analysis_scale}
            onChange={(e) =>
              edit(
                "analysis_scale",
                e.target.value as Indicator["analysis_scale"],
              )
            }
          >
            <option value="interval">等距评分（interval）</option>
            <option value="ordinal">有序等级（ordinal）</option>
          </select>
        </label>
        <label className="field">
          分数含义
          <select
            value={i.direction}
            onChange={(e) =>
              edit("direction", e.target.value as Indicator["direction"])
            }
          >
            <option value="neutral">中性强度</option>
            <option value="higher_better">越高越好</option>
            <option value="lower_better">越低越好</option>
          </select>
        </label>
      </div>
      <div className="actions">
        <label className="check-label">
          <input
            type="checkbox"
            checked={i.required}
            onChange={(e) => edit("required", e.target.checked)}
          />
          必答
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={i.allow_not_evaluable}
            onChange={(e) => edit("allow_not_evaluable", e.target.checked)}
          />
          允许无法评价（必须填写原因）
        </label>
      </div>
      {i.kind === "anchored" && (
        <div className="anchor-editor">
          <p>左闭右开，最后一档右闭；相邻边界必须连续，且落在步长网格上。</p>
          {i.anchors.map((a, k) => (
            <div className="anchor-row" key={k}>
              <label>
                下限
                <input
                  type="number"
                  step="any"
                  value={a.from}
                  onChange={(e) =>
                    edit(
                      "anchors",
                      i.anchors.map((x, j) =>
                        j === k ? { ...x, from: Number(e.target.value) } : x,
                      ),
                    )
                  }
                />
              </label>
              <label>
                上限
                <input
                  type="number"
                  step="any"
                  value={a.to}
                  onChange={(e) =>
                    edit(
                      "anchors",
                      i.anchors.map((x, j) =>
                        j === k ? { ...x, to: Number(e.target.value) } : x,
                      ),
                    )
                  }
                />
              </label>
              <label>
                描述
                <input
                  value={a.label}
                  maxLength={200}
                  onChange={(e) =>
                    edit(
                      "anchors",
                      i.anchors.map((x, j) =>
                        j === k ? { ...x, label: e.target.value } : x,
                      ),
                    )
                  }
                />
              </label>
              <button
                className="icon-button"
                aria-label={"删除档位 " + (k + 1)}
                onClick={() =>
                  edit(
                    "anchors",
                    i.anchors.filter((_, j) => j !== k),
                  )
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <button
            disabled={i.anchors.length >= 10}
            onClick={() =>
              edit("anchors", [
                ...i.anchors,
                { label: "", from: i.anchors.at(-1)?.to ?? i.min, to: i.max },
              ])
            }
          >
            添加档位
          </button>
        </div>
      )}
    </div>
  );
}
