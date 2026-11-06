import { useEffect, useState, useRef } from "react";
import {
  Download,
  RefreshCw,
  ChartNoAxesCombined,
  Info,
  FileSpreadsheet,
  CalendarClock,
} from "lucide-react";
import type { Experiment, Snapshot } from "../domain/types";
import { describe, summarize } from "../features/analysis/statistics";
import { useApp, when } from "./context";
import { Empty, ErrorBox } from "./components";
const fmt = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("zh-CN", { maximumFractionDigits: 3 });
const palette = [
  "#35745d",
  "#d7a75c",
  "#7892a8",
  "#9b839d",
  "#c8735d",
  "#6c977b",
  "#759aa0",
  "#bc9280",
  "#a0a95e",
  "#aa7290",
  "#738dba",
  "#ad8b54",
];
export default function Analysis({
  experiment: e,
}: {
  experiment: Experiment;
}) {
  const { data, mutate, mode } = useApp();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(
      () =>
        data.snapshots
          .filter((s) => s.experiment_id === e.experiment_id)
          .at(-1) ?? null,
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("overview"),
    [indicator, setIndicator] = useState(
      e.config.indicators[0]?.indicator_id ?? "",
    ),
    [controller, setController] = useState<AbortController | null>(null),
    [fileStatus, setFileStatus] = useState("");
  const once = useRef(false);
  async function generate() {
    setBusy(true);
    setError("");
    try {
      const s = await mutate("createSnapshot", {
        experiment_id: e.experiment_id,
        expected_data_revision: e.data_revision,
      });
      setSnapshot(s);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (
      mode === "live" &&
      snapshot &&
      !data.snapshots.some((s) => s.snapshot_id === snapshot.snapshot_id)
    )
      setSnapshot(null);
  }, [data.snapshots, snapshot, mode]);
  useEffect(() => {
    if (!snapshot && !once.current) {
      once.current = true;
      void generate();
    }
  }, []);
  async function download(format: "xlsx" | "numeric-csv" | "text-csv") {
    if (!snapshot) return;
    const ctl = new AbortController();
    setController(ctl);
    setFileStatus("正在生成文件…");
    setError("");
    try {
      if (mode === "live")
        await mutate("recordExport", {
          snapshot_id: snapshot.snapshot_id,
          format: format === "xlsx" ? "xlsx" : "csv",
          dataset_kind:
            format === "numeric-csv"
              ? "numeric"
              : format === "text-csv"
                ? "text"
                : "all",
        });
      await (
        await import("../features/files")
      ).downloadResults(snapshot, format, ctl.signal);
      setFileStatus("文件已生成，已交给浏览器下载。");
    } catch (err) {
      setError(String(err));
      setFileStatus("下载未完成。");
    } finally {
      setController(null);
    }
  }
  const rows = snapshot ? summarize(snapshot) : [],
    current =
      e.config.indicators.find((i) => i.indicator_id === indicator) ??
      e.config.indicators[0],
    stale = snapshot && snapshot.data_revision !== e.data_revision;
  return (
    <>
      <ErrorBox message={error} />
      <section className="panel snapshot-bar">
        <div>
          <span className="eyebrow">FROZEN DATA SNAPSHOT</span>
          <h2>感受，开始成为洞察</h2>
          <p>
            {snapshot
              ? "数据截止：" +
                when(snapshot.created_at) +
                " · 数据版本 " +
                snapshot.data_revision
              : "正在创建一致的数据快照…"}
          </p>
          <small className="muted">
            {snapshot
              ? "快照 " + snapshot.snapshot_id
              : "仅当前已提交、激活且未撤销的记录纳入分析。"}
          </small>
        </div>
        <button disabled={busy} onClick={() => void generate()}>
          <RefreshCw size={16} />
          {busy ? "正在生成…" : "更新分析快照"}
        </button>
      </section>
      {stale && (
        <div className="returned-notice">
          <strong>这份分析已过时</strong>
          <p>
            实验数据或任务覆盖已变化。当前图表和下载保持原快照，点击更新后查看新数据。
          </p>
        </div>
      )}
      <div className="tabs filter-tabs">
        {[
          ["overview", "指标概览"],
          ["distribution", "指标分布"],
          ["text", "文字反馈"],
          ["advanced", "进阶分析"],
        ].map(([id, t]) => (
          <button
            key={id}
            className={tab === id ? "selected" : ""}
            onClick={() => setTab(id)}
          >
            {t}
          </button>
        ))}
      </div>
      {snapshot && (
        <>
          {tab === "overview" && (
            <>
              <div className="stats-grid three">
                <article className="stat-card">
                  <span>纳入的样品提交</span>
                  <strong>{snapshot.rows.length}</strong>
                  <small>每人 × 每样品最新有效修订</small>
                </article>
                <article className="stat-card">
                  <span>活跃评价员</span>
                  <strong>
                    {
                      new Set(
                        snapshot.coverage
                          .filter((c) => c.assignment_state === "active")
                          .map((c) => c.participant_code),
                      ).size
                    }
                  </strong>
                  <small>缺少提交不当作零分</small>
                </article>
                <article className="stat-card">
                  <span>未纳入样品记录</span>
                  <strong>
                    {snapshot.coverage.filter((c) => !c.included).length}
                  </strong>
                  <small>草稿、退回、撤销或停用等</small>
                </article>
              </div>
              {snapshot.rows.length === 0 ? (
                <Empty title="还没有有效提交">
                  仍可下载带表头和方法说明的结果文件。
                </Empty>
              ) : (
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>样品评分概览</h2>
                      <p>各样品可用评分的均值；有序等级以中位数为主要摘要。</p>
                    </div>
                    <label className="field inline-field">
                      指标
                      <select
                        value={indicator}
                        onChange={(ev) => setIndicator(ev.target.value)}
                      >
                        {snapshot.config.indicators.map((i) => (
                          <option key={i.indicator_id} value={i.indicator_id}>
                            {i.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <Chart
                    option={{
                      color: palette,
                      tooltip: { trigger: "axis" },
                      grid: { left: 45, right: 20, bottom: 35, top: 25 },
                      xAxis: {
                        type: "category",
                        data: snapshot.config.samples.map(
                          (s) => "样品 " + s.code,
                        ),
                      },
                      yAxis: {
                        type: "value",
                        min: current.min,
                        max: current.max,
                        name:
                          current.analysis_scale === "ordinal"
                            ? "中位数"
                            : "均值",
                      },
                      series: [
                        {
                          type: "bar",
                          barMaxWidth: 58,
                          data: snapshot.config.samples.map((s, k) => ({
                            value:
                              current.analysis_scale === "ordinal"
                                ? rows.find(
                                    (r) =>
                                      r.sample_id === s.sample_id &&
                                      r.indicator_id === indicator,
                                  )?.median
                                : rows.find(
                                    (r) =>
                                      r.sample_id === s.sample_id &&
                                      r.indicator_id === indicator,
                                  )?.mean,
                            itemStyle: {
                              color: palette[k % palette.length],
                              borderRadius: [5, 5, 0, 0],
                            },
                          })),
                        },
                      ],
                    }}
                  />
                  <p className="chart-note">
                    图表没有置信区间或显著性标记；各格实际人数见下方数值表。
                  </p>
                </section>
              )}
              <StatsTable snapshot={snapshot} />
              <section className="panel">
                <h2>任务覆盖与排除情况</h2>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>代号</th>
                        <th>样品</th>
                        <th>任务</th>
                        <th>样品状态</th>
                        <th>纳入 / 原因</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.coverage.map((c, k) => (
                        <tr key={k}>
                          <td>{c.participant_code}</td>
                          <td>
                            {
                              snapshot.config.samples.find(
                                (s) => s.sample_id === c.sample_id,
                              )?.code
                            }
                          </td>
                          <td>
                            {c.assignment_state === "active"
                              ? "活跃"
                              : "已撤销"}
                          </td>
                          <td>
                            {(
                              {
                                submitted: "已提交",
                                returned: "已退回",
                                draft: "草稿",
                                not_started: "未开始",
                                none: "未开始",
                              } as Record<string, string>
                            )[c.response_state] ?? c.response_state}
                          </td>
                          <td>
                            {c.included ? "已纳入" : reasonLabel(c.reason)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
          {tab === "distribution" && (
            <>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>评分分布 · 箱线图</h2>
                    <p>
                      Type 7 分位数；须端为 1.5 × IQR
                      内的实际观测值，离群点仍纳入统计。
                    </p>
                  </div>
                  <select
                    aria-label="箱线图指标"
                    value={indicator}
                    onChange={(ev) => setIndicator(ev.target.value)}
                  >
                    {snapshot.config.indicators.map((i) => (
                      <option key={i.indicator_id} value={i.indicator_id}>
                        {i.label}
                      </option>
                    ))}
                  </select>
                </div>
                {snapshot.rows.length ? (
                  <Chart
                    option={boxOption(
                      snapshot,
                      indicator,
                      current.min,
                      current.max,
                    )}
                  />
                ) : (
                  <Empty title="无有效评分" />
                )}
              </section>
              <section className="panel">
                <h2>样品轮廓 · 雷达图</h2>
                <p>
                  按配置上下限归一化至
                  0–100；不是质量总分，不按面积排名。缺少任一指标均值的样品不绘制完整轮廓。
                </p>
                {snapshot.config.indicators.length >= 3 ? (
                  <Chart option={radarOption(snapshot)} />
                ) : (
                  <p className="info-box">
                    至少 3
                    项指标才能绘制有意义的雷达轮廓。请使用数值表查看当前指标。
                  </p>
                )}
                <StatsTable snapshot={snapshot} />
              </section>
            </>
          )}
          {tab === "text" && (
            <section className="panel">
              <h2>文字反馈原文</h2>
              <p className="muted">
                仅显示当前快照的有效提交，按代号展示，不改写原话。
              </p>
              {snapshot.config.text_questions.length === 0 ? (
                <Empty title="此实验没有文字题" />
              ) : (
                snapshot.config.samples.map((s) => (
                  <section className="text-sample" key={s.sample_id}>
                    <h3>样品 {s.code}</h3>
                    {snapshot.config.text_questions.map((q) => (
                      <div key={q.text_question_id}>
                        <h4>{q.label}</h4>
                        {snapshot.rows
                          .filter((r) => r.sample_id === s.sample_id)
                          .map((r) => (
                            <blockquote key={r.revision_id}>
                              <p className="pre-wrap">
                                {r.answers.text.find(
                                  (t) =>
                                    t.text_question_id === q.text_question_id,
                                )?.value || "（未填）"}
                              </p>
                              <cite>
                                {r.participant_code} · 修订 {r.revision_no}
                              </cite>
                            </blockquote>
                          ))}
                      </div>
                    ))}
                  </section>
                ))
              )}
            </section>
          )}
          {tab === "advanced" && (
            <section className="panel">
              <div className="empty">
                <ChartNoAxesCombined size={36} />
                <h2>当前版本未提供进阶推断</h2>
                <p>
                  当前工作区仅提供真实计算的描述统计。重复测量分析、配对比较、Holm
                  校正与评分模式复核需要经过验证的受控统计服务。
                </p>
                <p>这里不会生成预制 p 值、显著性星号或评价员优劣排名。</p>
              </div>
            </section>
          )}
          <section className="panel export-panel">
            <div>
              <span className="eyebrow">TAKE YOUR DATA WITH YOU</span>
              <h2>下载到本机</h2>
              <p>
                配置、数值、文字、统计与任务覆盖使用上方同一快照。默认不含邮箱与昵称。
              </p>
              <small>
                CSV 为补充格式，首次打开也请勿执行公式；人工查看优先选择 Excel。
              </small>
            </div>
            <div className="export-actions">
              <button
                className="primary"
                disabled={Boolean(controller)}
                onClick={() => void download("xlsx")}
              >
                <FileSpreadsheet size={17} />
                下载完整 Excel
              </button>
              <button
                disabled={Boolean(controller)}
                onClick={() => void download("numeric-csv")}
              >
                <Download size={16} />
                数值 CSV
              </button>
              <button
                disabled={Boolean(controller)}
                onClick={() => void download("text-csv")}
              >
                文字 CSV
              </button>
              {controller && (
                <button onClick={() => controller.abort()}>取消生成</button>
              )}
              <span role="status">{fileStatus}</span>
            </div>
          </section>
          <section className="panel method-note">
            <Info size={20} />
            <p>
              分析口径：仅激活账户、活跃任务、当前已提交样品的最新修订。缺失不补零；SD
              为样本标准差，单值不计算。固定呈送顺序未控制顺序效应。
              {mode === "live"
                ? "数据来自授权的服务端快照。"
                : "数据为本浏览器演示记录。"}
            </p>
          </section>
        </>
      )}
    </>
  );
}
function reasonLabel(reason: string) {
  const labels: Record<string, string> = {
    included: "已纳入",
    account_disabled: "账户停用",
    profile_disabled: "账户停用",
    assignment_revoked: "任务撤销",
    revoked: "任务撤销",
    draft: "未提交草稿",
    returned: "退回待修改",
    not_started: "未开始",
    no_response: "未开始",
    not_submitted: "尚未提交",
    config_mismatch: "配置版本不匹配",
  };
  return labels[reason.toLowerCase()] ?? reason;
}
function StatsTable({ snapshot }: { snapshot: Snapshot }) {
  const rows = summarize(snapshot);
  return (
    <section className="stats-table">
      <h3>描述统计数值表</h3>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>样品</th>
              <th>指标 / 尺度</th>
              <th>有效 n</th>
              <th>缺失 n</th>
              <th>均值</th>
              <th>样本 SD</th>
              <th>中位数</th>
              <th>Q1</th>
              <th>Q3</th>
              <th>最小</th>
              <th>最大</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const i = snapshot.config.indicators.find(
                (i) => i.indicator_id === r.indicator_id,
              )!;
              return (
                <tr key={r.sample_id + ":" + r.indicator_id}>
                  <td>
                    {
                      snapshot.config.samples.find(
                        (s) => s.sample_id === r.sample_id,
                      )?.code
                    }
                  </td>
                  <td>
                    {i.label}
                    <small>
                      {i.analysis_scale === "ordinal"
                        ? "有序编码，主看中位数"
                        : "等距评分"}
                    </small>
                  </td>
                  <td>{r.n_valid}</td>
                  <td>{r.n_missing}</td>
                  <td>{fmt(r.mean)}</td>
                  <td>{fmt(r.sd)}</td>
                  <td>{fmt(r.median)}</td>
                  <td>{fmt(r.q1)}</td>
                  <td>{fmt(r.q3)}</td>
                  <td>{fmt(r.min)}</td>
                  <td>{fmt(r.max)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function Chart({ option }: { option: Record<string, unknown> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let chart: import("echarts").ECharts | undefined;
    let active = true;
    let obs: ResizeObserver | undefined;
    void import("echarts").then((e) => {
      if (!active || !ref.current) return;
      chart = e.init(ref.current);
      chart.setOption({
        ...option,
        animation: !matchMedia("(prefers-reduced-motion: reduce)").matches,
      });
      obs = new ResizeObserver(() => chart?.resize());
      obs.observe(ref.current);
    });
    return () => {
      active = false;
      obs?.disconnect();
      chart?.dispose();
    };
  }, [option]);
  return (
    <div
      ref={ref}
      className="chart"
      role="img"
      aria-label="统计图表，详细数值见下方数据表"
    />
  );
}
function boxOption(s: Snapshot, id: string, min: number, max: number) {
  const outliers: number[][] = [];
  const data = s.config.samples.map((sample, k) => {
    const vs = s.rows
      .filter((r) => r.sample_id === sample.sample_id)
      .map((r) => r.answers.numeric.find((a) => a.indicator_id === id)?.value)
      .filter((v): v is number => v !== null && v !== undefined)
      .sort((a, b) => a - b);
    const d = describe(vs);
    if (!vs.length) return [];
    const low = d.q1! - 1.5 * (d.q3! - d.q1!),
      high = d.q3! + 1.5 * (d.q3! - d.q1!);
    vs.filter((v) => v < low || v > high).forEach((v) => outliers.push([k, v]));
    return [
      vs.find((v) => v >= low),
      d.q1,
      d.median,
      d.q3,
      vs.findLast((v) => v <= high),
    ];
  });
  return {
    tooltip: { trigger: "item" },
    grid: { left: 45, right: 20, top: 25, bottom: 40 },
    xAxis: {
      type: "category",
      data: s.config.samples.map((x) => "样品 " + x.code),
    },
    yAxis: { type: "value", min, max },
    series: [
      {
        name: "评分分布",
        type: "boxplot",
        data,
        itemStyle: { color: "#e1ede6", borderColor: "#35745d" },
      },
      {
        name: "离群观测（仍纳入统计）",
        type: "scatter",
        data: outliers,
        itemStyle: { color: "#bf9061" },
      },
    ],
  };
}
function radarOption(s: Snapshot) {
  const stats = summarize(s);
  return {
    color: palette,
    tooltip: {},
    legend: { bottom: 0 },
    radar: {
      radius: "60%",
      indicator: s.config.indicators.map((i) => ({
        name: i.label,
        min: 0,
        max: 100,
      })),
    },
    series: [
      {
        type: "radar",
        data: s.config.samples
          .filter((sample) =>
            s.config.indicators.every((i) =>
              stats.some(
                (r) =>
                  r.sample_id === sample.sample_id &&
                  r.indicator_id === i.indicator_id &&
                  r.mean !== null,
              ),
            ),
          )
          .map((sample) => ({
            name: "样品 " + sample.code,
            value: s.config.indicators.map(
              (i) =>
                (100 *
                  (stats.find(
                    (r) =>
                      r.sample_id === sample.sample_id &&
                      r.indicator_id === i.indicator_id,
                  )!.mean! -
                    i.min)) /
                (i.max - i.min),
            ),
          })),
      },
    ],
  };
}
