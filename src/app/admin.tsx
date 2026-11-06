import { useState, lazy, Suspense } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  Plus,
  ArrowRight,
  FlaskConical,
  ClipboardCheck,
  Users,
  ArrowUpRight,
  ArrowLeft,
  Copy,
  Download,
  Send,
  Search,
  ChartNoAxesCombined,
  Clock,
  Check,
  ExternalLink,
} from "lucide-react";
import { useApp, when, statusLabel } from "./context";
import {
  Badge,
  PageTitle,
  Empty,
  Progress,
  ErrorBox,
  Dialog,
} from "./components";
import { ConfigPreview } from "./editor";
import type { Assignment, Experiment, Response } from "../domain/types";
const Analysis = lazy(() => import("./analysis"));
function completion(
  assignment: Assignment,
  experiment: Experiment,
  responses: Response[],
) {
  return responses.filter(
    (r) =>
      r.assignment_id === assignment.assignment_id && r.state === "submitted",
  ).length;
}
export function Dashboard() {
  const { data, mode } = useApp();
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all");
  const exps = data.experiments.filter(
    (e) =>
      (filter === "all" || e.status === filter) &&
      e.config.experiment.title.includes(query),
  );
  const cards = [
    [
      FlaskConical,
      "全部实验",
      data.experiments.length,
      "每个好问题，都从这里开始",
    ],
    [
      Clock,
      "进行中",
      data.experiments.filter((e) => e.status === "published").length,
      "保持感受，持续收集",
    ],
    [
      Users,
      "激活评价员",
      data.profiles.filter(
        (p) => p.state === "active" && p.role === "participant",
      ).length,
      "独立评价，共同完成",
    ],
    [
      ClipboardCheck,
      "有效提交",
      data.responses.filter(
        (r) =>
          r.state === "submitted" &&
          data.assignments.some(
            (a) =>
              a.assignment_id === r.assignment_id &&
              a.state === "active" &&
              data.profiles.some(
                (p) => p.user_id === a.user_id && p.state === "active",
              ),
          ),
      ).length,
      "一份记录，一份认真",
    ],
  ];
  return (
    <>
      <PageTitle
        eyebrow="YOUR SENSORY WORKSPACE"
        title="实验工作台"
        description="从一个好问题开始，让每次评价有条不紊。"
        actions={
          <Link to="/admin/experiments/new" className="button primary">
            <Plus size={18} />
            创建实验
          </Link>
        }
      />
      <div className="guide-card">
        <span className="guide-icon">
          <LeafMark />
        </span>
        <div>
          <strong>
            {mode === "live" ? "欢迎来到知味工作区" : "欢迎来到知味演示工作区"}
          </strong>
          <p>
            {mode === "live"
              ? "创建或打开实验，分配评价员，查看采集进度与分析结果。"
              : "打开实验 → 切换评价员填写 → 返回管理员查看结果。下方示例可直接操作。"}
          </p>
        </div>
        <span className="guide-label">从感受到洞察</span>
      </div>
      <div className="stats-grid">
        {cards.map(([Icon, label, value, desc]) => {
          const I = Icon as typeof FlaskConical;
          return (
            <article className="stat-card" key={String(label)}>
              <div className="row spread">
                <span>{String(label)}</span>
                <I size={19} />
              </div>
              <strong>{String(value).padStart(2, "0")}</strong>
              <small>{String(desc)}</small>
            </article>
          );
        })}
      </div>
      <section className="experiments-section">
        <div className="section-heading">
          <div>
            <h2>
              我的实验 <span className="count">{data.experiments.length}</span>
            </h2>
            <p>设计、收集与分析，尽在一处。</p>
          </div>
          <label className="search">
            <Search size={17} />
            <span className="sr-only">搜索实验</span>
            <input
              placeholder="搜索实验名称"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        <div className="tabs filter-tabs">
          {[
            ["all", "全部实验"],
            ["published", "进行中"],
            ["draft", "草稿"],
            ["closed", "已关闭"],
            ["archived", "已归档"],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={filter === id ? "selected" : ""}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="experiment-grid">
          {exps.map((e) => {
            const assignments = data.assignments.filter(
              (a) =>
                a.experiment_id === e.experiment_id && a.state === "active",
            );
            const total = assignments.length * e.config.samples.length;
            const done = assignments.reduce(
              (n, a) => n + completion(a, e, data.responses),
              0,
            );
            return (
              <article className="experiment-card" key={e.experiment_id}>
                <div className="row spread">
                  <span className={"experiment-symbol " + e.status}>
                    <FlaskConical size={24} />
                  </span>
                  <Badge status={e.status} />
                </div>
                <span className="sample-label">
                  {mode === "live" ? "正式实验" : "示例 / 本地实验"}
                </span>
                <h3>
                  <Link to={"/admin/experiments/" + e.experiment_id}>
                    {e.config.experiment.title || "未命名实验"}
                  </Link>
                </h3>
                <p>
                  {e.config.experiment.description ||
                    "还没有实验说明，继续完善你的设计。"}
                </p>
                <div className="experiment-meta">
                  <span>{e.config.samples.length} 个样品</span>
                  <span>{e.config.indicators.length} 项指标</span>
                  <span>{assignments.length} 位评价员</span>
                </div>
                <div className="card-progress">
                  <div className="row spread">
                    <span>
                      {e.status === "draft"
                        ? "完善配置后即可发布"
                        : "样品提交进度"}
                    </span>
                    <strong>
                      {total ? Math.round((done / total) * 100) : 0}%
                    </strong>
                  </div>
                  <Progress value={done} total={total} />
                </div>
                <div className="card-footer">
                  <span>{when(e.created_at).split(" ")[0]}</span>
                  <Link to={"/admin/experiments/" + e.experiment_id}>
                    {e.status === "draft" ? "继续设计" : "打开工作台"}{" "}
                    <ArrowUpRight size={16} />
                  </Link>
                </div>
              </article>
            );
          })}
          <Link className="new-experiment-card" to="/admin/experiments/new">
            <span>
              <Plus size={24} />
            </span>
            <strong>开始一场新实验</strong>
            <p>
              把你的下一个研究问题
              <br />
              变成清晰的评价任务
            </p>
          </Link>
        </div>
        {exps.length === 0 && (
          <Empty title="没有匹配的实验">换个关键词或创建你的第一个实验。</Empty>
        )}
      </section>
    </>
  );
}
function LeafMark() {
  return <FlaskConical size={26} />;
}
export function ExperimentPage() {
  const { experimentId } = useParams(),
    { data, mutate, setNotice } = useApp(),
    navigate = useNavigate();
  const e = data.experiments.find((x) => x.experiment_id === experimentId);
  const [tab, setTab] = useState("overview"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [modal, setModal] = useState<{
      kind: string;
      target?: Response | Assignment;
    } | null>(null),
    [reason, setReason] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [progressFilter, setProgressFilter] = useState("all"),
    [preview, setPreview] = useState(false);
  if (!e)
    return (
      <Empty title="无法访问此实验">
        <Link to="/admin">返回实验工作台</Link>
      </Empty>
    );
  const assignments = data.assignments.filter(
      (a) => a.experiment_id === e.experiment_id,
    ),
    responses = data.responses.filter((r) =>
      assignments.some((a) => a.assignment_id === r.assignment_id),
    );
  const active = assignments.filter((a) => a.state === "active");
  const submitted = responses.filter(
    (r) =>
      r.state === "submitted" &&
      active.some((a) => a.assignment_id === r.assignment_id),
  );
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    const config = structuredClone(e!.config);
    config.experiment.title = (config.experiment.title + "（副本）").slice(
      0,
      100,
    );
    config.experiment.opens_at = null;
    config.experiment.closes_at = null;
    const n = await mutate("createDraft", { config });
    setNotice("已复制配置，新实验不包含原任务和答卷。");
    navigate("/admin/experiments/" + n.experiment_id + "/edit");
  }
  async function confirm() {
    await run(async () => {
      if (modal?.kind === "return") {
        const r = modal.target as Response;
        await mutate("returnResponse", {
          response_id: r.response_id,
          reason,
          expected_version: r.edit_version,
        });
      } else if (modal?.kind === "assignment") {
        const a = modal.target as Assignment;
        await mutate("setAssignmentState", {
          assignment_id: a.assignment_id,
          state: a.state === "active" ? "revoked" : "active",
          reason,
          expected_version: a.edit_version,
        });
      } else if (modal?.kind === "delete") {
        await mutate("deleteDraft", {
          experiment_id: e!.experiment_id,
          expected_version: e!.edit_version,
        });
        navigate("/admin");
      } else {
        await mutate("transition", {
          experiment_id: e!.experiment_id,
          target: modal?.kind,
          reason,
          expected_version: e!.edit_version,
        });
      }
      setModal(null);
      setReason("");
      setNotice("操作已完成。");
    });
  }
  function taskStatus(a: Assignment) {
    const rs = responses.filter((r) => r.assignment_id === a.assignment_id);
    return a.state === "revoked"
      ? "revoked"
      : rs.some((r) => r.state === "returned")
        ? "returned"
        : rs.filter((r) => r.state === "submitted").length ===
            e!.config.samples.length
          ? "complete"
          : rs.length
            ? "progress"
            : "new";
  }
  const names: Record<string, string> = {
    revoked: "已撤销",
    returned: "有退回项",
    complete: "已完成",
    progress: "填写中",
    new: "未开始",
  };
  return (
    <>
      <Link className="back-link" to="/admin">
        <ArrowLeft size={15} />
        全部实验
      </Link>
      <PageTitle
        eyebrow="EXPERIMENT WORKBENCH"
        title={e.config.experiment.title || "未命名实验"}
        description={e.config.experiment.description}
        actions={
          <>
            <button disabled={busy} onClick={() => void run(copy)}>
              <Copy size={16} />
              复制实验
            </button>
            {e.status === "draft" ? (
              <Link
                className="button primary"
                to={"/admin/experiments/" + e.experiment_id + "/edit"}
              >
                继续设计 <ArrowRight size={16} />
              </Link>
            ) : (
              <button
                onClick={() => {
                  const url =
                    location.origin +
                    location.pathname +
                    "#/tasks?experiment=" +
                    e.experiment_id;
                  void navigator.clipboard
                    .writeText(url)
                    .then(() =>
                      setNotice("实验链接已复制；接收者仍须获分配任务。"),
                    )
                    .catch(() => setError("复制不可用，请手动复制：" + url));
                }}
              >
                <ExternalLink size={16} />
                复制实验链接
              </button>
            )}
          </>
        }
      />
      <ErrorBox message={error} />
      <div className="experiment-info">
        <Badge status={e.status} />
        <span>{e.config.samples.length} 个样品</span>
        <span>{e.config.indicators.length} 项指标</span>
        <span>固定样品顺序</span>
        <span>截止：{when(e.config.experiment.closes_at)}</span>
      </div>
      <div className="tabs workbench-tabs">
        {[
          ["overview", "实验概览"],
          ["assignments", "人员与进度"],
          ["responses", "评价记录"],
          ["analysis", "分析与导出"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "selected" : ""}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "overview" && (
        <div className="overview-grid">
          <section className="panel">
            <div className="panel-heading">
              <h2>实验配置</h2>
              <button onClick={() => setPreview(true)}>
                评价员预览 <EyeIcon />
              </button>
            </div>
            <p className="pre-wrap">
              {e.config.experiment.instructions || "暂无填写说明。"}
            </p>
            <h3>样品与建议顺序</h3>
            <div className="sample-list">
              {e.config.samples.map((s, k) => (
                <div key={s.sample_id}>
                  <span className="order-number">{k + 1}</span>
                  <strong>{s.code}</strong>
                  <span>{s.admin_name}</span>
                </div>
              ))}
            </div>
            <h3>评分指标</h3>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>指标</th>
                    <th>量程 / 步长</th>
                    <th>类型</th>
                  </tr>
                </thead>
                <tbody>
                  {e.config.indicators.map((i) => (
                    <tr key={i.indicator_id}>
                      <td>
                        {i.category} · {i.label}
                      </td>
                      <td>
                        {i.min}–{i.max} / {i.step}
                      </td>
                      <td>
                        {i.analysis_scale === "ordinal"
                          ? "有序等级"
                          : "等距评分"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="actions">
              <button
                onClick={() =>
                  void run(async () => {
                    const f = await import("../features/files");
                    await f.downloadConfig(e.config, "json");
                  })
                }
              >
                <Download size={16} />
                下载 JSON 配置
              </button>
              <button
                onClick={() =>
                  void run(async () => {
                    const f = await import("../features/files");
                    await f.downloadConfig(e.config, "xlsx");
                  })
                }
              >
                下载 Excel 配置
              </button>
            </div>
          </section>
          <aside>
            <section className="panel">
              <span className="eyebrow">COLLECTION PROGRESS</span>
              <h2>评价进度</h2>
              <strong className="big-number">
                {submitted.length}
                <small> / {active.length * e.config.samples.length}</small>
              </strong>
              <Progress
                value={submitted.length}
                total={active.length * e.config.samples.length}
              />
              <p className="muted">当前已提交样品 / 活跃任务应评样品</p>
              <button className="full" onClick={() => setTab("assignments")}>
                <Users size={16} />
                管理评价员分配
              </button>
            </section>
            <section className="panel">
              <h3>实验生命周期</h3>
              <p className="muted">
                发布后配置锁定。关闭与归档保留历史，不能重新开放。
              </p>
              {e.status === "draft" && (
                <button
                  className="danger"
                  onClick={() => {
                    setReason("删除草稿");
                    setModal({ kind: "delete" });
                  }}
                >
                  删除未发布草稿
                </button>
              )}
              {e.status === "published" && (
                <button onClick={() => setModal({ kind: "closed" })}>
                  关闭实验采集
                </button>
              )}
              {e.status === "closed" && (
                <button onClick={() => setModal({ kind: "archived" })}>
                  归档实验
                </button>
              )}
              {e.status === "archived" && <Badge status="archived" />}
            </section>
          </aside>
        </div>
      )}
      {tab === "assignments" && (
        <>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>分配评价任务</h2>
                <p>已发布实验可以分配。分享链接本身不授予访问权限。</p>
              </div>
            </div>
            {e.status === "published" ? (
              <>
                <div className="participant-picks">
                  {data.profiles
                    .filter((p) => p.state === "active")
                    .map((p) => {
                      const assigned = assignments.find(
                        (a) => a.user_id === p.user_id,
                      );
                      return (
                        <label
                          className={
                            "participant-pick " + (assigned ? "assigned" : "")
                          }
                          key={p.user_id}
                        >
                          <input
                            type="checkbox"
                            checked={selected.includes(p.user_id)}
                            disabled={Boolean(assigned)}
                            onChange={(ev) =>
                              setSelected(
                                ev.target.checked
                                  ? [...selected, p.user_id]
                                  : selected.filter((i) => i !== p.user_id),
                              )
                            }
                          />
                          <span className="avatar">
                            {p.display_name.slice(0, 1)}
                          </span>
                          <span>
                            <strong>{p.display_name}</strong>
                            <small>
                              {p.participant_code}{" "}
                              {assigned
                                ? "· " + statusLabel[assigned.state]
                                : ""}
                            </small>
                          </span>
                        </label>
                      );
                    })}
                </div>
                <button
                  className="primary"
                  disabled={busy || selected.length === 0}
                  onClick={() =>
                    void run(async () => {
                      await mutate("assign", {
                        experiment_id: e.experiment_id,
                        user_ids: selected,
                      });
                      setSelected([]);
                      setNotice("评价任务已分配。");
                    })
                  }
                >
                  <Send size={16} />
                  分配所选评价员（{selected.length}）
                </button>
              </>
            ) : (
              <p className="info-box">
                {e.status === "draft"
                  ? "请先发布实验，再分配评价员。"
                  : "实验已结束，不接受新分配。"}
              </p>
            )}
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>任务完成情况</h2>
              <select
                aria-label="筛选任务进度"
                value={progressFilter}
                onChange={(e) => setProgressFilter(e.target.value)}
              >
                <option value="all">全部状态</option>
                {Object.entries(names).map(([v, t]) => (
                  <option value={v} key={v}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            {assignments.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>评价员</th>
                      <th>状态</th>
                      <th>已提交样品</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignments
                      .filter(
                        (a) =>
                          progressFilter === "all" ||
                          taskStatus(a) === progressFilter,
                      )
                      .map((a) => {
                        const p = data.profiles.find(
                          (p) => p.user_id === a.user_id,
                        );
                        return (
                          <tr key={a.assignment_id}>
                            <td>
                              <strong>{p?.display_name}</strong>
                              <small>{p?.participant_code}</small>
                            </td>
                            <td>{names[taskStatus(a)]}</td>
                            <td>
                              <Progress
                                value={completion(a, e, responses)}
                                total={e.config.samples.length}
                              />
                            </td>
                            <td>
                              <button
                                disabled={
                                  busy ||
                                  e.status === "archived" ||
                                  (e.status !== "published" &&
                                    a.state === "revoked")
                                }
                                onClick={() =>
                                  setModal({ kind: "assignment", target: a })
                                }
                              >
                                {a.state === "active" ? "撤销分配" : "恢复任务"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="尚未分配评价员">
                在上方选择评价员，发起第一份评价任务。
              </Empty>
            )}
          </section>
        </>
      )}
      {tab === "responses" && (
        <section className="panel">
          <div className="panel-heading">
            <h2>样品评价记录</h2>
            <span className="muted">保留每次提交修订，草稿不纳入统计</span>
          </div>
          {responses.length ? (
            <div className="response-list">
              {responses.map((r) => {
                const a = assignments.find(
                  (a) => a.assignment_id === r.assignment_id,
                )!;
                const p = data.profiles.find((p) => p.user_id === a.user_id);
                const sample = e.config.samples.find(
                  (s) => s.sample_id === r.sample_id,
                );
                const revision = data.revisions.find(
                  (x) => x.revision_id === r.latest_revision_id,
                );
                return (
                  <div key={r.response_id} className="response-row">
                    <div>
                      <strong>
                        {p?.participant_code} · 样品 {sample?.code}
                      </strong>
                      <p>
                        {revision || r.latest_revision_no
                          ? "修订 " +
                            (revision?.revision_no ?? r.latest_revision_no) +
                            " · " +
                            when(
                              revision?.submitted_at ?? r.latest_submitted_at,
                            )
                          : "尚未提交"}
                        {r.returned_reason &&
                          " · 退回原因：" + r.returned_reason}
                      </p>
                    </div>
                    <Badge status={r.state} />
                    <Link className="button" to={"/records/" + r.response_id}>
                      查看记录
                    </Link>
                    {r.state === "submitted" && e.status === "published" && (
                      <button
                        onClick={() => setModal({ kind: "return", target: r })}
                      >
                        退回修改
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty title="等待第一份评价">
              切换到已分配的评价员身份，开始填写样品。
            </Empty>
          )}
        </section>
      )}
      {tab === "analysis" &&
        (e.status === "draft" ? (
          <Empty title="发布后可查看分析">
            草稿没有正式提交数据。请先发布并分配任务。
          </Empty>
        ) : (
          <Suspense
            fallback={
              <div className="panel" role="status">
                正在加载分析模块…
              </div>
            }
          >
            <Analysis experiment={e} />
          </Suspense>
        ))}
      {preview && (
        <Dialog title="评价员预览" onClose={() => setPreview(false)}>
          <ConfigPreview config={e.config} />
        </Dialog>
      )}
      {modal && (
        <Dialog
          title={
            modal.kind === "return"
              ? "退回此样品评价"
              : modal.kind === "assignment"
                ? "变更任务分配"
                : modal.kind === "delete"
                  ? "删除未发布草稿"
                  : "确认" + (modal.kind === "closed" ? "关闭实验" : "归档实验")
          }
          onClose={() => {
            setModal(null);
            setReason("");
          }}
        >
          <p>
            {modal.kind === "return"
              ? "旧修订会保留；退回期间此样品不计完成和统计。"
              : modal.kind === "assignment"
                ? "撤销会立即阻止新填写并排除当前统计；恢复沿用原任务历史。"
                : modal.kind === "delete"
                  ? "此操作只删除未发布草稿。"
                  : "实验将停止采集，已保存历史仍可查看及导出。"}
          </p>
          <label className="field">
            操作原因 *
            <textarea
              value={reason}
              onChange={(ev) => setReason(ev.target.value)}
              maxLength={2000}
            />
          </label>
          <ErrorBox message={error} />
          <div className="dialog-actions">
            <button onClick={() => setModal(null)}>取消</button>
            <button
              className="primary"
              disabled={busy || !reason.trim()}
              onClick={() => void confirm()}
            >
              确认操作
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
function EyeIcon() {
  return <ExternalLink size={16} />;
}
export function Participants() {
  const { data, mutate, setNotice, mode } = useApp();
  const [selected, setSelected] = useState<string | null>(null),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [query, setQuery] = useState("");
  const profile = data.profiles.find((p) => p.user_id === selected);
  return (
    <>
      <PageTitle
        eyebrow="PEOPLE IN THE LAB"
        title="评价员管理"
        description="每一个独立的评价，都让实验更完整。"
        actions={
          mode !== "live" && (
            <Link to="/auth" className="button">
              <Plus size={16} />
              创建演示身份
            </Link>
          )
        }
      />
      <section className="panel">
        <div className="panel-heading">
          <h2>
            工作区成员 <span className="count">{data.profiles.length}</span>
          </h2>
          <label className="search">
            <Search size={16} />
            <input
              aria-label="搜索评价员"
              placeholder="搜索昵称或代号"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>评价员</th>
                <th>角色</th>
                <th>状态</th>
                <th>任务</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {data.profiles
                .filter(
                  (p) =>
                    p.display_name.includes(query) ||
                    p.participant_code.includes(query),
                )
                .map((p) => (
                  <tr key={p.user_id}>
                    <td>
                      <div className="row">
                        <span className="avatar">
                          {p.display_name.slice(0, 1)}
                        </span>
                        <div>
                          <strong>{p.display_name}</strong>
                          <small>
                            {p.participant_code}
                            {mode !== "live" && " · 演示"}
                          </small>
                        </div>
                      </div>
                    </td>
                    <td>{p.role === "admin" ? "管理员" : "评价员"}</td>
                    <td>
                      <Badge status={p.state} />
                    </td>
                    <td>
                      {
                        data.assignments.filter(
                          (a) =>
                            a.user_id === p.user_id && a.state === "active",
                        ).length
                      }
                    </td>
                    <td>
                      <button
                        onClick={() => {
                          setSelected(p.user_id);
                          setReason("");
                          setError("");
                        }}
                      >
                        {p.state === "disabled" ? "恢复账户" : "停用账户"}
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
      {profile && (
        <Dialog
          title={profile.state === "disabled" ? "恢复此账户？" : "停用此账户？"}
          onClose={() => setSelected(null)}
        >
          <p>
            停用会阻止新访问，并从新统计中排除该用户的答案；不删除历史。最后一位有效管理员受到保护。
          </p>
          <label className="field">
            原因
            <textarea
              value={reason}
              maxLength={2000}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <ErrorBox message={error} />
          <div className="dialog-actions">
            <button onClick={() => setSelected(null)}>取消</button>
            <button
              className="primary"
              disabled={!reason.trim()}
              onClick={async () => {
                try {
                  await mutate("setProfileState", {
                    user_id: profile.user_id,
                    state: profile.state === "disabled" ? "active" : "disabled",
                    reason,
                    expected_version: profile.edit_version,
                  });
                  setSelected(null);
                  setNotice("账户状态已更新。");
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              确认变更
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
