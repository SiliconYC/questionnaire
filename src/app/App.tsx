import { useState, lazy, Suspense } from "react";
import {
  Link,
  NavLink,
  Route,
  Routes,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  FlaskConical,
  LayoutDashboard,
  ClipboardList,
  Users,
  Settings,
  ArrowUpRight,
  Leaf,
  Check,
  ShieldCheck,
  ChartNoAxesCombined,
  Menu,
  LogOut,
} from "lucide-react";
import { Provider, useApp } from "./context";
import { leaveCurrentPage } from "./navigation";
import { ErrorBox, PageTitle, Dialog } from "./components";
import { Dashboard, ExperimentPage, Participants } from "./admin";
import { Editor } from "./editor";
import { Tasks, TaskDetail, SampleForm, RecordPage } from "./participant";
const LiveApp = lazy(() => import("./live"));
export default function App() {
  return __APP_MODE__ === "live" ? (
    <Suspense fallback={<p>正在连接真实工作区…</p>}>
      <LiveApp />
    </Suspense>
  ) : (
    <Provider>
      <Shell />
    </Provider>
  );
}
export function Shell({ live = false }: { live?: boolean }) {
  const {
    actor,
    identities,
    switchActor,
    loading,
    error,
    notice,
    setNotice,
    refresh,
    signOut,
  } = useApp();
  const location = useLocation(),
    navigate = useNavigate();
  const home = !live && location.pathname === "/",
    admin = actor?.role === "admin";
  return (
    <>
      <a
        className="skip"
        href="#/"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        跳到主要内容
      </a>
      <div className="demo-bar">
        <span className="demo-dot" />
        <strong>{live ? "真实工作区" : "演示模式"}</strong>
        <span className="demo-long">
          {live
            ? " · 数据经授权保存到共享工作区。"
            : " · 数据仅保存在当前浏览器，重置或清理浏览器数据后会丢失。"}
        </span>
        <span className="demo-short">
          {live ? " · 云端保存" : " · 仅当前浏览器保存"}
        </span>
        <Link to="/settings">{live ? "工作区说明" : "了解演示"}</Link>
      </div>
      {home ? (
        <Home />
      ) : (
        <div className="workspace">
          <aside className="sidebar">
            <Brand />
            <div className="workspace-label">
              感官评价工作区 <span>{live ? "LIVE" : "DEMO"}</span>
            </div>
            <nav aria-label="主导航">
              {admin && (
                <>
                  <NavLink to="/admin" end>
                    <LayoutDashboard />
                    实验工作台
                  </NavLink>
                  <NavLink to="/admin/participants">
                    <Users />
                    评价员管理
                  </NavLink>
                </>
              )}
              <NavLink to="/tasks">
                <ClipboardList />
                我的评价任务
              </NavLink>
              <NavLink to="/settings">
                <Settings />
                工作区设置
              </NavLink>
            </nav>
            <div className="sidebar-note">
              <Leaf size={20} />
              <p>
                认真感受，独立表达。
                <br />
                让每一次评价更有价值。
              </p>
            </div>
            <Link className="back-home" to="/">
              返回网站首页 <ArrowUpRight size={16} />
            </Link>
          </aside>
          <div className="workspace-body">
            <header className="topbar">
              <div className="mobile-brand">
                <Brand />
              </div>
              <div className="breadcrumb">
                工作区 <span>/</span>{" "}
                {location.pathname.startsWith("/admin")
                  ? "实验管理"
                  : location.pathname.startsWith("/tasks")
                    ? "样品评价"
                    : "个人中心"}
              </div>
              <div className="identity">
                <span className="avatar">
                  {actor?.display_name.slice(0, 1) ?? "演"}
                </span>
                {live ? (
                  <>
                    <span>{actor?.display_name}</span>
                    <button
                      onClick={async () => {
                        if (await leaveCurrentPage()) await signOut?.();
                      }}
                    >
                      退出
                    </button>
                  </>
                ) : (
                  <label>
                    <span className="sr-only">切换演示身份</span>
                    <select
                      aria-label="切换演示身份"
                      value={actor?.user_id ?? "demo-admin"}
                      onChange={async (e) => {
                        const id = e.target.value;
                        if (!(await leaveCurrentPage())) return;
                        await switchActor(id);
                        navigate(id === "demo-admin" ? "/admin" : "/tasks");
                      }}
                    >
                      {identities.map((p) => (
                        <option key={p.user_id} value={p.user_id}>
                          {p.display_name} ·{" "}
                          {p.role === "admin" ? "管理员" : "评价员"}（演示）
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </header>
            <main id="main" tabIndex={-1} className="main">
              {notice && (
                <div className="toast" role="status">
                  {notice}
                  <button aria-label="关闭通知" onClick={() => setNotice("")}>
                    ×
                  </button>
                </div>
              )}
              {loading ? (
                <div className="empty" role="status">
                  正在读取本浏览器的工作区…
                </div>
              ) : error ? (
                <>
                  <ErrorBox message={error} />
                  <button onClick={() => void refresh()}>重试读取</button>
                </>
              ) : actor?.state === "disabled" ? (
                <ErrorBox message="此演示身份已停用，请联系管理员恢复。" />
              ) : (
                <Routes>
                  {live && (
                    <Route
                      path="/"
                      element={
                        <Navigate to={admin ? "/admin" : "/tasks"} replace />
                      }
                    />
                  )}
                  <Route
                    path="/admin"
                    element={admin ? <Dashboard /> : <Denied />}
                  />
                  <Route
                    path="/admin/experiments/new"
                    element={admin ? <Editor /> : <Denied />}
                  />
                  <Route
                    path="/admin/experiments/:experimentId/edit"
                    element={admin ? <Editor /> : <Denied />}
                  />
                  <Route
                    path="/admin/experiments/:experimentId"
                    element={admin ? <ExperimentPage /> : <Denied />}
                  />
                  <Route
                    path="/admin/participants"
                    element={admin ? <Participants /> : <Denied />}
                  />
                  <Route path="/tasks" element={<Tasks />} />
                  <Route path="/tasks/:assignmentId" element={<TaskDetail />} />
                  <Route
                    path="/tasks/:assignmentId/samples/:sampleId"
                    element={<SampleForm />}
                  />
                  <Route path="/records/:responseId" element={<RecordPage />} />
                  <Route
                    path="/settings"
                    element={live ? <LiveSettings /> : <WorkspaceSettings />}
                  />
                  <Route
                    path="/auth"
                    element={live ? <Denied /> : <DemoAuth />}
                  />
                  <Route path="/onboarding" element={<DemoAuth />} />
                  <Route path="*" element={<Denied />} />
                </Routes>
              )}
            </main>
            <footer className="footer">
              <span>知味 · 感官评价工作台</span>
              <span>
                {live ? "真实工作区" : "演示版本"} 1.0 ·{" "}
                {__BUILD_SHA__.slice(0, 7)} · 时间：Asia/Shanghai
              </span>
            </footer>
            <nav className="mobile-nav" aria-label="手机导航">
              {admin && (
                <NavLink to="/admin" end>
                  <LayoutDashboard size={20} />
                  实验
                </NavLink>
              )}
              <NavLink to="/tasks">
                <ClipboardList size={20} />
                任务
              </NavLink>
              {admin && (
                <NavLink to="/admin/participants">
                  <Users size={20} />
                  评价员
                </NavLink>
              )}
              <NavLink to="/settings">
                <Settings size={20} />
                设置
              </NavLink>
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
function Brand() {
  return (
    <Link to="/" className="brand">
      <span className="brand-symbol">
        <FlaskConical size={24} />
      </span>
      <span>
        知味<small>SENSORY LAB</small>
      </span>
    </Link>
  );
}
function Home() {
  const { switchActor } = useApp();
  return (
    <div className="landing">
      <header className="landing-header">
        <Brand />
        <nav>
          <a
            href="#/"
            onClick={(event) => {
              event.preventDefault();
              document
                .getElementById("workflow")
                ?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            如何使用
          </a>
          <a
            href="https://github.com/SiliconYC/questionnaire"
            target="_blank"
            rel="noreferrer"
          >
            GitHub <ArrowUpRight size={14} />
          </a>
        </nav>
      </header>
      <main id="main" tabIndex={-1}>
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">
              <span className="line" /> 为感官研究，留下一份可靠记录
            </span>
            <h1>
              让每一份感受，
              <br />
              都有据可循。
            </h1>
            <p>
              从实验设计到样品评价，再到数据分析。
              <br className="desktop-only" />
              一个清晰、专注的感官评价工作台。
            </p>
            <div className="hero-buttons">
              <Link
                className="button primary"
                to="/admin"
                onClick={() => void switchActor("demo-admin")}
              >
                体验演示 <ArrowUpRight size={18} />
              </Link>
              <a
                className="button light"
                href="#/"
                onClick={(event) => {
                  event.preventDefault();
                  document
                    .getElementById("workflow")
                    ?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                了解工作流程
              </a>
            </div>
            <div className="hero-checks">
              <span>
                <Check size={16} /> 无需注册
              </span>
              <span>
                <Check size={16} /> 电脑与手机可用
              </span>
              <span>
                <Check size={16} /> 本浏览器保存
              </span>
            </div>
          </div>
          <div className="hero-visual" aria-label="感官评价流程示意">
            <div className="visual-top">
              <span className="mini-dot" /> 一场好实验，从细微的感受开始
            </div>
            <div className="specimen specimen-a">
              <span>样品编码</span>
              <strong>001</strong>
              <div className="sample-art">
                <i />
                <i />
                <i />
              </div>
              <small>独立感受 · 如实记录</small>
            </div>
            <div className="floating-score">
              <span>香气强度</span>
              <strong>
                7.5 <small>/ 10</small>
              </strong>
              <div className="score-line">
                <i />
              </div>
              <span className="muted">每一个分数，都有自己的意义</span>
            </div>
            <div className="floating-note">
              <Leaf size={22} />
              <div>
                <strong>感受有不同，记录有标准。</strong>
                <small>清晰量表 · 逐样品评价 · 可追溯结果</small>
              </div>
            </div>
            <div className="visual-grid" />
          </div>
        </section>
        <section className="workflow" id="workflow">
          <div className="section-title">
            <span className="eyebrow">A SIMPLE, COMPLETE WORKFLOW</span>
            <h2>把精力留给评价本身</h2>
            <p>三步串起实验全程，每个环节都清楚可查。</p>
          </div>
          <div className="workflow-grid">
            {[
              [
                FlaskConical,
                "01",
                "设计一场实验",
                "配置样品、评分指标与文字题，也可以导入 Excel，快速开始。",
              ],
              [
                ClipboardList,
                "02",
                "收集真实感受",
                "分配评价任务，逐样品独立填写，自动保存草稿，提交后留下回执。",
              ],
              [
                ChartNoAxesCombined,
                "03",
                "读懂你的数据",
                "查看进度、比较分布，按同一数据快照下载统计与原始记录。",
              ],
            ].map(([Icon, n, t, d]) => {
              const I = Icon as typeof FlaskConical;
              return (
                <article key={String(n)}>
                  <div className="workflow-icon">
                    <I size={24} />
                  </div>
                  <span className="step-number">{String(n)}</span>
                  <h3>{String(t)}</h3>
                  <p>{String(d)}</p>
                </article>
              );
            })}
          </div>
        </section>
        <section className="landing-note">
          <ShieldCheck />
          <div>
            <h3>放心体验，也清楚边界</h3>
            <p>
              这是可以实际操作的演示工作区，使用示例身份和本地数据。电脑、手机均可访问；不同设备或浏览器的数据各自独立。真实账户、共享数据与推断分析尚未接入。
            </p>
          </div>
          <Link to="/settings">
            查看说明 <ArrowUpRight size={16} />
          </Link>
        </section>
      </main>
      <footer className="landing-footer">
        <Brand />
        <span>为每一次细致的感受而设计。</span>
        <span>© 2026 SiliconYC</span>
      </footer>
    </div>
  );
}
export function Denied() {
  return (
    <div className="empty">
      <h1>无法访问此内容</h1>
      <p>请检查身份、任务分配或链接。</p>
      <Link className="button" to="/tasks">
        返回我的任务
      </Link>
    </div>
  );
}
function WorkspaceSettings() {
  const { actor, mutate, switchActor, setNotice } = useApp();
  const [reset, setReset] = useState(false),
    [error, setError] = useState("");
  const [confirm, setConfirm] = useState("");
  return (
    <>
      <PageTitle
        eyebrow="WORKSPACE SETTINGS"
        title="工作区设置"
        description="了解数据保存方式与当前可用能力。"
      />
      <section className="panel settings-panel">
        <h2>你的演示身份</h2>
        <p>
          {actor?.display_name} · {actor?.participant_code} ·{" "}
          {actor?.role === "admin" ? "管理员" : "评价员"}（演示）
        </p>
        <Link className="button" to="/auth">
          创建本地演示身份
        </Link>
        <h2>数据保存在这里</h2>
        <p>
          演示模式 ·
          数据仅保存在当前浏览器，重置或清理浏览器数据后会丢失。手机与电脑上的演示工作区彼此独立。
        </p>
        <p>
          配置和结果可以下载到本机；不要在演示中填写真实个人敏感资料。示例数据为人工构造，不代表科学结论。
        </p>
        <h2>真实协作与进阶分析</h2>
        <p>
          当前未配置真实认证、共享数据库和受控统计服务。没有真实邮件、跨设备同步或推断检验。接入说明见仓库文档。
        </p>
        <a
          className="button"
          href="https://github.com/SiliconYC/questionnaire/blob/dev/docs/live-setup.md"
          target="_blank"
          rel="noreferrer"
        >
          查看真实服务接入说明 <ArrowUpRight size={16} />
        </a>
        <h2>演示数据管理</h2>
        <div className="actions">
          <button className="danger" onClick={() => setReset(true)}>
            重置演示数据
          </button>
          <button
            onClick={() => {
              sessionStorage.removeItem("questionnaire:demo:identity:v1");
              location.hash = "/";
              location.reload();
            }}
          >
            <LogOut size={16} />
            退出演示身份
          </button>
        </div>
      </section>
      {reset && (
        <Dialog title="重置当前浏览器的演示？" onClose={() => setReset(false)}>
          <p>
            这会清除当前浏览器的演示实验、任务、草稿及提交，恢复初始示例。请先下载需要保留的结果。
          </p>
          <label className="field">
            输入“重置”以确认
            <input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
          <ErrorBox message={error} />
          <div className="dialog-actions">
            <button onClick={() => setReset(false)}>取消</button>
            <button
              className="danger"
              disabled={confirm !== "重置"}
              onClick={async () => {
                try {
                  await mutate("reset");
                  await switchActor("demo-admin");
                  setReset(false);
                  setNotice("已恢复初始演示数据。");
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              确认重置
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
function DemoAuth() {
  const { mutate, switchActor } = useApp(),
    navigate = useNavigate();
  const [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [step, setStep] = useState(0),
    [error, setError] = useState("");
  return (
    <>
      <PageTitle
        eyebrow="DEMO IDENTITY"
        title="创建演示身份"
        description="不采集密码，不发送邮件，仅在当前浏览器创建。"
      />
      <form
        className="panel narrow"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          if (step === 0) {
            setStep(1);
            return;
          }
          try {
            const p = await mutate("createIdentity", { display_name: name });
            await switchActor(p.user_id);
            navigate("/tasks");
          } catch (e) {
            setError(String(e));
          }
        }}
      >
        <label className="field">
          昵称
          <input
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={step === 1}
          />
        </label>
        <label className="field">
          虚构邮箱标识
          <input
            type="email"
            placeholder="taster@example.invalid"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={step === 1}
          />
        </label>
        {step === 1 && (
          <div className="info-box">
            模拟验证：此步骤不会验证真实邮箱。确认后创建本地演示身份；可由演示管理员分配实验。
          </div>
        )}
        <ErrorBox message={error} />
        <button className="primary">
          {step === 0 ? "进入模拟验证" : "确认模拟验证并创建"}
        </button>
        {step === 1 && (
          <button type="button" onClick={() => setStep(0)}>
            返回修改
          </button>
        )}
      </form>
    </>
  );
}

function LiveSettings() {
  const { actor, signOut, mutate } = useApp();
  const [error, setError] = useState(""),
    [reason, setReason] = useState(""),
    [result, setResult] = useState("");
  return (
    <>
      <PageTitle
        eyebrow="LIVE WORKSPACE"
        title="真实工作区设置"
        description="数据由已配置的认证与数据库服务管理。"
      />
      <section className="panel settings-panel">
        <h2>当前身份</h2>
        <p>
          {actor?.display_name} · {actor?.participant_code} ·{" "}
          {actor?.role === "admin" ? "管理员" : "评价员"}
        </p>
        <h2>数据与访问</h2>
        <p>
          评分、草稿与分析保存在共享工作区。当前页面仅保留内存数据；退出会清除页面内存与本标签页的认证会话。新设备需重新验证邮箱。
        </p>
        <h2>申请删除本人数据</h2>
        <p>
          申请后由工作区负责人核验处理，提交申请不代表数据已被删除。已下载文件按实际告知由持有者处置。
        </p>
        <label className="field">
          申请原因
          <textarea
            value={reason}
            maxLength={2000}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <ErrorBox message={error} />
        {result && (
          <div role="status" className="info-box">
            {result}
          </div>
        )}
        <div className="actions">
          <button
            disabled={!reason.trim()}
            onClick={async () => {
              try {
                const r = await mutate("requestDeletion", { reason });
                setResult("删除申请已提交，编号：" + r.request_id);
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            提交删除申请
          </button>
          <button onClick={() => void signOut?.()}>退出当前会话</button>
        </div>
      </section>
    </>
  );
}
