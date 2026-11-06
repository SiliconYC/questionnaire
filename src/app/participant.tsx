import { useState, useRef, useEffect, useCallback } from "react";
import { Link, useParams, useNavigate, useBlocker } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ClipboardCheck,
  Clock,
  Save,
  Send,
  LockKeyhole,
  Info,
  Copy,
} from "lucide-react";
import type {
  Answers,
  Assignment,
  Experiment,
  Response,
  Revision,
} from "../domain/types";
import { validateAnswers, anchorFor } from "../domain/validation";
import { useApp, when } from "./context";
import { registerLeaveGuard } from "./navigation";
import {
  PageTitle,
  Empty,
  Badge,
  Progress,
  ErrorBox,
  Dialog,
} from "./components";
function isOpen(e: Experiment) {
  const now = Date.now();
  if (e.collection_ends_at && now >= Date.parse(e.collection_ends_at))
    return false;
  return (
    e.status === "published" &&
    (!e.config.experiment.opens_at ||
      new Date(e.config.experiment.opens_at).getTime() <= now) &&
    (!e.config.experiment.closes_at ||
      now < new Date(e.config.experiment.closes_at).getTime()) &&
    (!e.published_at ||
      now < new Date(e.published_at).getTime() + 365 * 86400000)
  );
}
function assignmentStatus(a: Assignment, e: Experiment, rs: Response[]) {
  return a.state === "revoked"
    ? "revoked"
    : rs.some((r) => r.state === "returned")
      ? "returned"
      : rs.filter((r) => r.state === "submitted").length ===
          e.config.samples.length
        ? "submitted"
        : rs.length
          ? "draft"
          : "new";
}
export function Tasks() {
  const { data, actor, mode } = useApp();
  const [filter, setFilter] = useState("all");
  const own = data.assignments.filter((a) => a.user_id === actor?.user_id);
  const filtered = own.filter((a) => {
    const e = data.experiments.find((e) => e.experiment_id === a.experiment_id);
    if (!e) return false;
    const st = assignmentStatus(
      a,
      e,
      data.responses.filter((r) => r.assignment_id === a.assignment_id),
    );
    return (
      filter === "all" ||
      (filter === "pending" && !["submitted", "revoked"].includes(st)) ||
      (filter === "complete" && st === "submitted") ||
      (filter === "returned" && st === "returned")
    );
  });
  return (
    <>
      <PageTitle
        eyebrow="YOUR EVALUATION TASKS"
        title="我的评价任务"
        description="独立感受，如实记录。每次只专注于眼前的样品。"
      />
      <div className="guide-card">
        <Info size={23} />
        <div>
          <strong>{actor?.display_name}，你好</strong>
          <p>请按实验说明评价样品。没有预设分数，未操作的滑杆不会计为答案。</p>
        </div>
      </div>
      <div className="tabs filter-tabs">
        {[
          ["all", "全部任务"],
          ["pending", "待完成"],
          ["returned", "有退回项"],
          ["complete", "已完成"],
        ].map(([id, t]) => (
          <button
            key={id}
            className={filter === id ? "selected" : ""}
            onClick={() => setFilter(id)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="task-grid">
        {filtered.map((a) => {
          const e = data.experiments.find(
            (e) => e.experiment_id === a.experiment_id,
          )!;
          const rs = data.responses.filter(
              (r) => r.assignment_id === a.assignment_id,
            ),
            done = rs.filter((r) => r.state === "submitted").length;
          return (
            <article className="task-card panel" key={a.assignment_id}>
              <div className="row spread">
                <span className="eyebrow">
                  感官评价{mode === "live" ? "" : " · 演示"}
                </span>
                <Badge status={assignmentStatus(a, e, rs)} />
              </div>
              <h2>{e.config.experiment.title}</h2>
              <p>{e.config.experiment.description}</p>
              <div className="experiment-meta">
                <span>{e.config.samples.length} 个样品</span>
                <span>{e.config.indicators.length} 项指标</span>
              </div>
              <Progress value={done} total={e.config.samples.length} />
              <div className="card-footer">
                <span>
                  {isOpen(e)
                    ? "开放评价中"
                    : e.status === "published"
                      ? "未开放或已截止"
                      : "已结束采集"}
                </span>
                <Link
                  className="button primary"
                  to={"/tasks/" + a.assignment_id}
                >
                  {done === e.config.samples.length ? "查看任务" : "开始评价"}{" "}
                  <ArrowRight size={16} />
                </Link>
              </div>
            </article>
          );
        })}
      </div>
      {filtered.length === 0 && (
        <Empty title="暂无匹配的评价任务">
          {actor?.role === "admin"
            ? "管理员参与评价也需要显式分配任务。到实验的人员与进度中选择自己的身份。"
            : mode === "live"
              ? "注册不会自动获得实验，请等待管理员分配任务。"
              : "注册不会自动获得实验。请切换演示管理员，为这个身份分配任务。"}
        </Empty>
      )}
    </>
  );
}
export function TaskDetail() {
  const { assignmentId } = useParams(),
    { data, mutate, mode } = useApp();
  const a = data.assignments.find((a) => a.assignment_id === assignmentId),
    e = data.experiments.find((e) => e.experiment_id === a?.experiment_id);
  const [agreed, setAgreed] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  if (!a || !e)
    return (
      <Empty title="无法访问此任务">
        <Link to="/tasks">返回任务列表</Link>
      </Empty>
    );
  return (
    <>
      <Link className="back-link" to="/tasks">
        <ArrowLeft size={16} />
        我的评价任务
      </Link>
      <PageTitle
        eyebrow="BEFORE YOU BEGIN"
        title={e.config.experiment.title}
        description={e.config.experiment.description}
      />
      <div className="fill-layout">
        <section className="panel">
          <h2>实验说明</h2>
          <p className="pre-wrap">
            {e.config.experiment.instructions ||
              "请逐样品独立评价，如实记录自己的感受。"}
          </p>
          <div className="info-box">
            样品按下方固定建议顺序展示，也可以独立选择样品填写。评价员不会看到其他人的评分。
          </div>
          <h3>参与及数据告知</h3>
          {mode === "live" ? (
            <FrozenNotice
              notice={a.privacy_notice ?? e.privacy_notice}
              policy={a.retention_policy ?? e.retention_policy}
            />
          ) : (
            <>
              <p>
                本实验用于演示感官评价流程，保存评分、文字反馈、提交修订及演示代号。数据仅在当前浏览器中，演示管理员可以查看并下载。请不要填写真实姓名、电话等敏感资料。清理浏览器或重置演示会删除数据。
              </p>
              <p className="muted">
                默认设计：采集最多 365 天，结束后保留 180
                天。演示由本机控制，不提供真实收集或服务器保留承诺。
              </p>
            </>
          )}
          <div className="two-col">
            <div>
              <small>开放时间（上海）</small>
              <p>{when(e.config.experiment.opens_at)}</p>
            </div>
            <div>
              <small>截止时间（上海）</small>
              <p>{when(e.config.experiment.closes_at)}</p>
            </div>
          </div>
          <ErrorBox message={error} />
          {!a.consented_at ? (
            <>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(ev) => setAgreed(ev.target.checked)}
                />
                我已阅读实验说明与
                {mode === "live" ? "数据告知" : "演示数据告知"}
              </label>
              <button
                className="primary"
                disabled={!agreed || busy || a.state !== "active"}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await mutate("acceptNotice", {
                      assignment_id: a.assignment_id,
                      config_version_id: a.config_version_id,
                      privacy_notice_version: a.privacy_notice_version,
                    });
                  } catch (e) {
                    setError(String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                同意并开始评价 <ArrowRight size={16} />
              </button>
            </>
          ) : (
            <p className="success-text">
              <Check size={17} />
              已于 {when(a.consented_at)} 接受实验告知。
            </p>
          )}
        </section>
        <aside className="panel sample-navigation">
          <h2>样品评价</h2>
          <p className="muted">建议按以下顺序独立品尝。</p>
          {a.state === "revoked" && (
            <ErrorBox message="此任务已撤销，不能继续保存和提交。" />
          )}
          {!isOpen(e) && (
            <div className="info-box">
              当前未开放或已结束采集，只能查看历史。
            </div>
          )}
          {e.config.samples.map((s, k) => {
            const r = data.responses.find(
              (r) =>
                r.assignment_id === a.assignment_id &&
                r.sample_id === s.sample_id,
            );
            return (
              <div className="sample-nav-item" key={s.sample_id}>
                <span className="order-number">{k + 1}</span>
                <div>
                  <strong>样品 {s.code}</strong>
                  {e.config.experiment.display_sample_names && (
                    <small>{s.display_name}</small>
                  )}
                  <small>
                    {r
                      ? r.state === "returned"
                        ? "已退回 · 请修改"
                        : r.state === "submitted"
                          ? "已提交"
                          : "草稿"
                      : "未开始"}
                  </small>
                </div>
                {a.consented_at ? (
                  <Link
                    className="button"
                    aria-label={"评价样品 " + s.code}
                    to={"/tasks/" + a.assignment_id + "/samples/" + s.sample_id}
                  >
                    {r?.state === "submitted" ? "查看" : "评价"}{" "}
                    <ArrowRight size={15} />
                  </Link>
                ) : (
                  <LockKeyhole size={16} />
                )}
              </div>
            );
          })}
        </aside>
      </div>
    </>
  );
}
export function SampleForm() {
  const { assignmentId, sampleId } = useParams();
  return (
    <Form
      key={assignmentId + ":" + sampleId}
      assignmentId={assignmentId!}
      sampleId={sampleId!}
    />
  );
}
function Form({
  assignmentId,
  sampleId,
}: {
  assignmentId: string;
  sampleId: string;
}) {
  const { data, actor, mutate, refresh, mode } = useApp(),
    navigate = useNavigate();
  const a = data.assignments.find(
      (a) => a.assignment_id === assignmentId && a.user_id === actor?.user_id,
    ),
    e = data.experiments.find((e) => e.experiment_id === a?.experiment_id),
    sample = e?.config.samples.find((s) => s.sample_id === sampleId),
    response = data.responses.find(
      (r) => r.assignment_id === assignmentId && r.sample_id === sampleId,
    );
  const [numeric, setNumeric] = useState<Record<string, string>>(() =>
      Object.fromEntries(
        response?.draft_answers.numeric.map((n) => [
          n.indicator_id,
          n.value === null ? "" : String(n.value),
        ]) ?? [],
      ),
    ),
    [missing, setMissing] = useState<Record<string, string>>(() =>
      Object.fromEntries(
        response?.draft_answers.numeric
          .filter((n) => n.missing_reason !== null)
          .map((n) => [n.indicator_id, n.missing_reason!]) ?? [],
      ),
    ),
    [texts, setTexts] = useState<Record<string, string>>(() =>
      Object.fromEntries(
        response?.draft_answers.text.map((t) => [
          t.text_question_id,
          t.value,
        ]) ?? [],
      ),
    );
  const [saveStatus, setSaveStatus] = useState(
      response
        ? (mode === "live" ? "已保存到工作区 · " : "已保存到本浏览器 · ") +
            when(response.saved_at)
        : "尚未作答",
    ),
    [error, setError] = useState(""),
    [issues, setIssues] = useState<ReturnType<typeof validateAnswers>>([]),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [receipt, setReceipt] = useState<Revision | null>(null),
    [dirty, setDirty] = useState(false),
    [conflict, setConflict] = useState(false);
  const version = useRef(response?.edit_version ?? 0),
    generation = useRef(0),
    savedGeneration = useRef(0),
    chain = useRef<Promise<unknown>>(Promise.resolve()),
    locked = useRef(response?.state === "submitted"),
    latest = useRef({ numeric, missing, texts }),
    mounted = useRef(true);
  latest.current = { numeric, missing, texts };
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      generation.current > savedGeneration.current &&
      !locked.current &&
      currentLocation.pathname !== nextLocation.pathname,
  );
  const readonly =
    !a ||
    a.state !== "active" ||
    !e ||
    !isOpen(e) ||
    !a.consented_at ||
    response?.state === "submitted";
  function answers(): Answers {
    return {
      numeric: e!.config.indicators.map((i) => ({
        indicator_id: i.indicator_id,
        value: Object.hasOwn(latest.current.missing, i.indicator_id)
          ? null
          : latest.current.numeric[i.indicator_id] === "" ||
              latest.current.numeric[i.indicator_id] === undefined
            ? null
            : Number(latest.current.numeric[i.indicator_id]),
        missing_reason: Object.hasOwn(latest.current.missing, i.indicator_id)
          ? latest.current.missing[i.indicator_id]
          : null,
      })),
      text: e!.config.text_questions.map((q) => ({
        text_question_id: q.text_question_id,
        value: latest.current.texts[q.text_question_id] ?? "",
      })),
    };
  }
  const save = useCallback(async () => {
    if (!e || !a || locked.current) return;
    const thisGeneration = generation.current;
    const payload = answers();
    const operation = chain.current
      .catch(() => {})
      .then(async () => {
        if (locked.current) return;
        if (thisGeneration <= savedGeneration.current) return;
        setSaveStatus("正在保存…");
        const r = await mutate("saveDraft", {
          assignment_id: assignmentId,
          sample_id: sampleId,
          config_version_id: a.config_version_id,
          answers: payload,
          expected_version: version.current,
        });
        version.current = r.edit_version;
        savedGeneration.current = thisGeneration;
        if (mounted.current) {
          setDirty(generation.current !== thisGeneration);
          setSaveStatus(
            (mode === "live" ? "已保存到工作区 · " : "已保存到本浏览器 · ") +
              when(r.saved_at),
          );
          setError("");
        }
      });
    chain.current = operation;
    try {
      await operation;
    } catch (err) {
      if (mounted.current) {
        setSaveStatus("保存失败，内容仍在当前页面");
        setError(String(err));
        if ((err as { code?: string }).code === "VERSION_CONFLICT")
          setConflict(true);
      }
      throw err;
    }
  }, [assignmentId, sampleId, a?.config_version_id, mutate]);
  async function flush() {
    while (generation.current > savedGeneration.current && !locked.current)
      await save();
  }
  useEffect(
    () =>
      registerLeaveGuard(async () => {
        try {
          await flush();
          return true;
        } catch {
          return false;
        }
      }),
    [save],
  );
  useEffect(() => {
    if (blocker.state === "blocked")
      void flush()
        .then(() => blocker.proceed())
        .catch(() => {});
  }, [blocker.state]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!dirty || readonly || conflict) return;
    const t = setTimeout(() => void save().catch(() => {}), 800);
    return () => clearTimeout(t);
  }, [numeric, missing, texts, dirty, readonly, conflict, save]);
  useEffect(() => {
    if (!dirty) return;
    const h = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
  function edited() {
    generation.current++;
    setDirty(true);
    setSaveStatus("有未保存修改");
    setIssues([]);
  }
  async function go(to: string) {
    if (dirty) {
      try {
        await flush();
      } catch {
        setError("离开前请先保存，或复制尚未保存的内容。");
        return;
      }
    }
    navigate(to);
  }
  if (!a || !e || !sample)
    return (
      <Empty title="无法访问此样品">
        <Link to="/tasks">返回任务列表</Link>
      </Empty>
    );
  const currentRevision = data.revisions.find(
    (r) => r.revision_id === response?.latest_revision_id,
  );
  if (receipt || response?.state === "submitted") {
    const r = receipt ?? currentRevision;
    return (
      <>
        <Link className="back-link" to={"/tasks/" + a.assignment_id}>
          <ArrowLeft size={16} />
          返回样品列表
        </Link>
        <section className="panel receipt">
          <div className="receipt-icon">
            <ClipboardCheck size={36} />
          </div>
          <span className="eyebrow">SAMPLE SUBMITTED</span>
          <h1>{receipt ? "提交成功" : "此样品已提交"}</h1>
          <p>
            样品 {sample.code} · 修订 {r?.revision_no}
          </p>
          <div className="receipt-details">
            <span>
              回执编号<strong>{r?.revision_id}</strong>
            </span>
            <span>
              提交时间（{mode === "live" ? "服务端时间" : "演示设备时间"}）
              <strong>{when(r?.submitted_at)}</strong>
            </span>
          </div>
          <Link className="button" to={"/records/" + response?.response_id}>
            查看只读答卷
          </Link>
          <button
            className="primary"
            onClick={() => navigate("/tasks/" + a.assignment_id)}
          >
            继续下一样品 <ArrowRight size={16} />
          </button>
        </section>
      </>
    );
  }
  return (
    <>
      <button
        className="back-link"
        onClick={() => void go("/tasks/" + a.assignment_id)}
      >
        <ArrowLeft size={16} />
        返回样品列表
      </button>
      <div className="fill-page-title">
        <div>
          <span className="eyebrow">{e.config.experiment.title}</span>
          <h1>
            样品 <span>{sample.code}</span>
          </h1>
          {e.config.experiment.display_sample_names && (
            <p>{sample.display_name}</p>
          )}
        </div>
        <span className="sample-counter">
          第 {e.config.samples.findIndex((s) => s.sample_id === sampleId) + 1} /{" "}
          {e.config.samples.length} 个样品
        </span>
      </div>
      <div className="fill-layout">
        <div>
          <div className="form-intro">
            <Info size={20} />
            <p>
              请独立评价当前样品。分数没有预设答案；滑杆和输入框同步，初始保持为空。
            </p>
          </div>
          {response?.returned_reason && (
            <div className="returned-notice">
              <strong>此样品已退回，请修改后重新提交</strong>
              <p>原因：{response.returned_reason}</p>
            </div>
          )}
          {readonly && (
            <ErrorBox message="当前任务未授权、已撤销、未开放或已截止，不能保存与提交。" />
          )}
          <ErrorBox message={error} />
          {issues.length > 0 && (
            <div className="error-box" role="alert">
              <strong>请完善以下答案：</strong>
              <ul>
                {issues.map((i, k) => (
                  <li key={k}>{i.message}</li>
                ))}
              </ul>
            </div>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const errs = validateAnswers(e.config, answers(), true);
              setIssues(errs);
              if (errs.length) {
                document
                  .querySelector<HTMLInputElement>('[aria-invalid="true"]')
                  ?.focus();
                return;
              }
              setConfirm(true);
            }}
          >
            {e.config.indicators.map((i, k) => {
              const value = numeric[i.indicator_id] ?? "",
                isMissing = Object.hasOwn(missing, i.indicator_id);
              const anchor = value !== "" ? anchorFor(i, Number(value)) : null;
              const invalid = issues.some(
                (x) =>
                  x.path.includes(i.indicator_id) ||
                  x.path.includes("/numeric/" + k),
              );
              return (
                <fieldset
                  className="panel question-card"
                  disabled={readonly || busy}
                  key={i.indicator_id}
                >
                  <div className="question-category">
                    <span>{String(k + 1).padStart(2, "0")}</span>
                    {i.category}
                    <small>{i.required ? "必答" : "选答"}</small>
                  </div>
                  <label htmlFor={"score-" + i.indicator_id}>
                    <h2>
                      {i.label}
                      {i.required && <span className="required"> *</span>}
                    </h2>
                  </label>
                  <p>{i.description}</p>
                  <div className="score-controls">
                    <div className="score-input">
                      <input
                        id={"score-" + i.indicator_id}
                        aria-label={i.label}
                        type="number"
                        inputMode="decimal"
                        step={i.step}
                        min={i.min}
                        max={i.max}
                        value={value}
                        placeholder="待评分"
                        disabled={isMissing || readonly || busy}
                        aria-invalid={invalid}
                        onChange={(ev) => {
                          setNumeric({
                            ...numeric,
                            [i.indicator_id]: ev.target.value,
                          });
                          edited();
                        }}
                        onBlur={() => {
                          if (dirty) void save().catch(() => {});
                        }}
                      />
                      <span>/ {i.max}</span>
                    </div>
                    <span className="muted">
                      范围 {i.min}–{i.max} · 步长 {i.step}
                    </span>
                  </div>
                  <div
                    className={
                      "slider-area " + (value === "" ? "unanswered" : "")
                    }
                  >
                    <input
                      type="range"
                      aria-label={i.label + "滑杆"}
                      min={i.min}
                      max={i.max}
                      step={i.step}
                      value={value === "" ? i.min : value}
                      disabled={isMissing || readonly || busy}
                      onChange={(ev) => {
                        setNumeric({
                          ...numeric,
                          [i.indicator_id]: ev.target.value,
                        });
                        edited();
                      }}
                      onPointerDown={(ev) => {
                        if (value === "" && !isMissing) {
                          const box = ev.currentTarget.getBoundingClientRect();
                          const n = Math.max(
                            0,
                            Math.min(1, (ev.clientX - box.left) / box.width),
                          );
                          const v =
                            i.min +
                            Math.round((n * (i.max - i.min)) / i.step) * i.step;
                          setNumeric({
                            ...numeric,
                            [i.indicator_id]: String(Number(v.toFixed(2))),
                          });
                          edited();
                        }
                      }}
                    />
                    <div className="range-labels">
                      <span>{i.min}</span>
                      <span>
                        {value === ""
                          ? "未作答 · 移动滑杆或输入分数"
                          : isMissing
                            ? "无法评价"
                            : "当前评分 " + value}
                      </span>
                      <span>{i.max}</span>
                    </div>
                  </div>
                  {i.anchors.length > 0 && (
                    <div className="anchors">
                      {i.anchors.map((a, j) => (
                        <div
                          key={j}
                          className={anchor?.label === a.label ? "hit" : ""}
                        >
                          <strong>{a.label}</strong>
                          <small>
                            {a.from} ≤ 分数{" "}
                            {j === i.anchors.length - 1 ? "≤" : "<"} {a.to}
                          </small>
                        </div>
                      ))}
                    </div>
                  )}
                  {i.allow_not_evaluable && (
                    <>
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={isMissing}
                          onChange={(ev) => {
                            const n = { ...missing };
                            if (ev.target.checked) {
                              n[i.indicator_id] = "";
                              setNumeric({ ...numeric, [i.indicator_id]: "" });
                            } else delete n[i.indicator_id];
                            setMissing(n);
                            edited();
                          }}
                        />
                        无法评价此指标
                      </label>
                      {isMissing && (
                        <label className="field">
                          无法评价的原因 *
                          <textarea
                            maxLength={2000}
                            value={missing[i.indicator_id]}
                            onChange={(ev) => {
                              setMissing({
                                ...missing,
                                [i.indicator_id]: ev.target.value,
                              });
                              edited();
                            }}
                          />
                        </label>
                      )}
                    </>
                  )}
                </fieldset>
              );
            })}
            {e.config.text_questions.map((q, k) => (
              <fieldset
                className="panel question-card"
                disabled={readonly || busy}
                key={q.text_question_id}
              >
                <span className="question-category">
                  文字反馈 {k + 1}
                  <small>{q.required ? "必答" : "选答"}</small>
                </span>
                <label htmlFor={"text-" + q.text_question_id}>
                  <h2>
                    {q.label}
                    {q.required ? " *" : ""}
                  </h2>
                </label>
                <p>{q.description}</p>
                <textarea
                  id={"text-" + q.text_question_id}
                  aria-label={q.label}
                  rows={4}
                  value={texts[q.text_question_id] ?? ""}
                  aria-invalid={issues.some((i) =>
                    i.path.includes(q.text_question_id),
                  )}
                  onChange={(ev) => {
                    setTexts({
                      ...texts,
                      [q.text_question_id]: ev.target.value,
                    });
                    edited();
                  }}
                />
                <small className="character-count">
                  {Array.from(texts[q.text_question_id] ?? "").length} /{" "}
                  {q.max_length} 字符
                </small>
              </fieldset>
            ))}
            <div className="form-actions">
              <div role="status" className="save-status">
                <span className={"save-dot " + (dirty ? "dirty" : "")} />
                {saveStatus}
              </div>
              <div className="actions">
                <button
                  type="button"
                  disabled={readonly || busy || conflict}
                  onClick={() => void save().catch(() => {})}
                >
                  <Save size={16} />
                  保存草稿
                </button>
                <button
                  type="submit"
                  className="primary"
                  disabled={readonly || busy || conflict}
                >
                  <Send size={16} />
                  提交此样品
                </button>
              </div>
            </div>
          </form>
          {(error || conflict) && (
            <div className="panel">
              <p>保存失败的内容仍在当前页面。可先复制备份，再重新读取。</p>
              <div className="actions">
                <button
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(JSON.stringify(answers(), null, 2))
                      .then(() => setSaveStatus("当前内容已复制"))
                  }
                >
                  <Copy size={16} />
                  复制未保存内容
                </button>
                <button
                  onClick={async () => {
                    await refresh();
                    setConflict(true);
                  }}
                >
                  读取最新版本并比较
                </button>
              </div>
              {conflict && (
                <>
                  <p>
                    另一标签页已更新答卷。请比较本地内容与最新版本，明确选择后继续。
                  </p>
                  <div className="two-col">
                    <div>
                      <h3>当前未保存内容</h3>
                      <pre>{JSON.stringify(answers(), null, 2)}</pre>
                    </div>
                    <div>
                      <h3>
                        {mode === "live" ? "工作区" : "本浏览器"}最新已保存内容
                        · 版本 {response?.edit_version}
                      </h3>
                      <pre>
                        {JSON.stringify(response?.draft_answers, null, 2)}
                      </pre>
                    </div>
                  </div>
                  <div className="actions">
                    <button onClick={() => location.reload()}>
                      放弃本页修改并加载最新
                    </button>
                    <button
                      className="primary"
                      onClick={() => {
                        version.current = response?.edit_version ?? 0;
                        setConflict(false);
                        generation.current++;
                        setDirty(true);
                        setError("");
                        void save().catch(() => {});
                      }}
                    >
                      保留本页修改并再次保存
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <aside className="fill-aside">
          <section className="panel">
            <span className="eyebrow">TAKE YOUR TIME</span>
            <h3>专注于你的感受</h3>
            <p>
              观察外观，感受香气，细细品尝。无需与他人讨论或寻找“正确答案”。
            </p>
            <div className="aside-divider" />
            <p className="muted">
              停止输入 800ms 后自动保存。以“
              {mode === "live" ? "已保存到工作区" : "已保存到本浏览器"}”为准。
            </p>
            <p className="muted">
              每个样品单独提交。提交后请联系演示管理员退回，才能修改。
            </p>
          </section>
          <section className="panel">
            <h3>当前样品</h3>
            <strong className="big-sample">{sample.code}</strong>
            <p className="muted">固定建议顺序 · 不记录实际品尝顺序</p>
          </section>
        </aside>
      </div>
      {blocker.state === "blocked" && error && (
        <Dialog title="修改尚未保存" onClose={() => blocker.reset()}>
          <p>保存未完成。请留在本页重试或复制内容；明确放弃后才会离开。</p>
          <ErrorBox message={error} />
          <div className="dialog-actions">
            <button onClick={() => blocker.reset()}>留在本页</button>
            <button className="danger" onClick={() => blocker.proceed()}>
              放弃未保存修改并离开
            </button>
          </div>
        </Dialog>
      )}
      {confirm && (
        <Dialog title="提交此样品评价？" onClose={() => setConfirm(false)}>
          <p>
            请核对样品编码 <strong>{sample.code}</strong>
            。提交后将生成只读回执，修改需管理员退回。
          </p>
          <div className="submission-summary">
            {e.config.indicators.map((i) => (
              <div key={i.indicator_id}>
                <span>{i.label}</span>
                <strong>
                  {Object.hasOwn(missing, i.indicator_id)
                    ? "无法评价：" + missing[i.indicator_id]
                    : numeric[i.indicator_id] || "未填（选答）"}
                </strong>
              </div>
            ))}
          </div>
          <ErrorBox message={error} />
          <div className="dialog-actions">
            <button onClick={() => setConfirm(false)}>返回检查</button>
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await save();
                  await chain.current;
                  locked.current = true;
                  const r = await mutate("submit", {
                    assignment_id: a.assignment_id,
                    sample_id: sampleId,
                    config_version_id: a.config_version_id,
                    answers: answers(),
                    expected_version: version.current,
                  });
                  setDirty(false);
                  setReceipt(r);
                  setConfirm(false);
                } catch (err) {
                  locked.current = false;
                  setError(String(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "正在提交…" : "确认提交"}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
export function RecordPage() {
  const { responseId } = useParams(),
    { data } = useApp();
  const r = data.responses.find((r) => r.response_id === responseId),
    a = data.assignments.find((a) => a.assignment_id === r?.assignment_id),
    e = data.experiments.find((e) => e.experiment_id === a?.experiment_id);
  const [selected, setSelected] = useState<string>("");
  if (!r || !a || !e)
    return (
      <Empty title="无法访问此记录">
        <Link to="/tasks">返回任务列表</Link>
      </Empty>
    );
  const revisions = data.revisions
      .filter((x) => x.response_id === responseId)
      .sort((a, b) => b.revision_no - a.revision_no),
    revision =
      revisions.find((x) => x.revision_id === selected) ?? revisions[0],
    sample = e.config.samples.find((s) => s.sample_id === r.sample_id);
  return (
    <>
      <PageTitle
        eyebrow="SUBMISSION RECORD"
        title={"样品 " + sample?.code + " · 评价记录"}
        description="提交修订为只读历史。当前草稿与历史修订分别保存。"
        actions={
          <Link
            to={
              data.profiles.find((p) => p.role === "admin")
                ? "/admin/experiments/" + e.experiment_id
                : "/tasks/" + a.assignment_id
            }
            className="button"
          >
            返回工作台
          </Link>
        }
      />
      <section className="panel narrow">
        <div className="panel-heading">
          <Badge status={r.state} />
          <select
            aria-label="选择提交修订"
            value={revision?.revision_id ?? ""}
            onChange={(ev) => setSelected(ev.target.value)}
          >
            {revisions.map((x) => (
              <option key={x.revision_id} value={x.revision_id}>
                修订 {x.revision_no} · {when(x.submitted_at)}
              </option>
            ))}
          </select>
        </div>
        {r.returned_reason && (
          <div className="returned-notice">退回原因：{r.returned_reason}</div>
        )}
        {revision ? (
          <>
            <p>回执：{revision.revision_id}</p>
            <p>提交时间：{when(revision.submitted_at)}</p>
            {e.config.indicators.map((i) => {
              const answer = revision.answers.numeric.find(
                (n) => n.indicator_id === i.indicator_id,
              );
              return (
                <div className="record-answer" key={i.indicator_id}>
                  <span>{i.label}</span>
                  <strong>
                    {answer?.value ??
                      (answer?.missing_reason
                        ? "无法评价：" + answer.missing_reason
                        : "未填")}
                  </strong>
                </div>
              );
            })}
            {e.config.text_questions.map((q) => (
              <div className="record-answer" key={q.text_question_id}>
                <span>{q.label}</span>
                <p className="pre-wrap">
                  {revision.answers.text.find(
                    (t) => t.text_question_id === q.text_question_id,
                  )?.value || "未填"}
                </p>
              </div>
            ))}
          </>
        ) : (
          <Empty title="尚无正式提交">草稿不会生成提交回执。</Empty>
        )}
      </section>
    </>
  );
}
function FrozenNotice({
  notice,
  policy,
}: {
  notice?: Record<string, unknown>;
  policy?: Record<string, unknown>;
}) {
  const labels: Record<string, string> = {
    purpose: "用途",
    data_collected: "收集内容",
    access: "访问范围",
    controller: "负责人",
    contact: "联系方式",
    provider: "服务提供方",
    providers: "服务提供方",
    downloads: "下载文件处置",
    region: "服务区域",
    retention: "保留期限",
    deletion: "删除申请",
    retention_days: "结束后保留天数",
    max_collection_days: "最长采集天数",
  };
  return (
    <>
      {notice ? (
        Object.entries(notice).map(([key, v]) => (
          <p key={key}>
            <strong>{labels[key] ?? key}：</strong>
            {typeof v === "string" ? v : JSON.stringify(v)}
          </p>
        ))
      ) : (
        <ErrorBox message="无法读取此实验的冻结隐私告知，请联系管理员。" />
      )}
      {policy && (
        <p>
          {Object.entries(policy)
            .map(([k, v]) => (labels[k] ?? k) + "：" + v)
            .join("；")}
        </p>
      )}
      <p className="muted">
        评分、反馈及修订保存到授权工作区；仅保留必要代号。拒绝告知不能保存或提交。下载文件由持有者按告知妥善处理。
      </p>
    </>
  );
}
