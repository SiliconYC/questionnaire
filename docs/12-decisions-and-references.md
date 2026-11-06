# 12 · 决策记录与依据

核对日期：`2026-11-06`。下列平台事实来自官方资料；具体规模、工作流与算法组合是本项目的设计决定，不冒充平台强制要求或用户逐条确认。

## 1. 主要架构决定

| 决策 | 选定方案 | 原因与代价 |
| --- | --- | --- |
| ADR-01 · 前端形态 | React、TypeScript、Vite 静态应用 | 适合 Pages 与同一前端异地部署；需要构建步骤 |
| ADR-02 · 数据和身份 | 演示 IndexedDB；真实 Supabase Auth/PostgreSQL | 演示无外部依赖，真实可实现共享和授权；必须维护相同业务契约 |
| ADR-03 · 部署边界 | Pages 默认完整演示；真实登录应用另选合适托管 | 保留指定 Pages 展示目标，并正视敏感交易告诫；真实版本需要额外资源 |
| ADR-04 · 认证 | 真实版默认邮箱 OTP；无公开默认管理员密码 | 减少长期密码管理；真实对外发信需自定义 SMTP |
| ADR-05 · 分支发布 | `dev` 源码、临时分支 PR、未来 `gh-pages` 产物；不改冷 `main` | 使源码与静态发布产物分开；不添加 hosted runner 构建，Pages 自身仍会执行部署流程 |
| ADR-06 · 提交粒度 | 每个样品独立提交，历史修订不可变 | 容易恢复与审阅；必须处理部分完成和退回期间的统计口径 |
| ADR-07 · 配置冻结 | 发布时生成不可变配置与告知快照 | 历史数据不会随题目改动被重新解释；修改需复制新实验 |
| ADR-08 · 导入模型 | 五表 Excel 映射到统一 JSON Schema | 稳定 ID、档位边界和验证明确；不自动兼容原稿三表 |
| ADR-09 · 推断分析 | 重复测量 ANOVA 始终 GG + 配对 t + 任务级 Holm | 保留配对关系、明确多重比较；需要验证数值库和分析假设 |
| ADR-10 · 功能状态 | 模式、存储和进阶能力显式报告 | 演示可高度仿真且不误导；实现需要处理未配置/失败界面 |

## 2. 比较过的可行路线

| 路线 | 优点 | 不选为主方案的原因 |
| --- | --- | --- |
| 纯 Pages + 浏览器本地数据 | 成本和部署复杂度低，演示完整 | 无法单独提供可信账户、多人共享或真正服务器授权，保留为 M1 |
| 静态前端 + 托管后端 | 可共享前端并逐模块真实化 | 需要外部项目与配置；作为 M2 主方案，正式认证不默认承载于 Pages |
| Gradio/Python + SQLite 自托管 | 适合局域网原型、成熟 Python 统计方便 | 必须另运行服务器，不能直接在 Pages 运行；不符合当前主要展示方式 |

不把 GitHub Issues、仓库提交、公开 JSON 文件当问卷数据库；不把 GitHub Token 嵌入浏览器实现“写回仓库”。浏览器本地密码表也不构成正式认证。

## 3. 对原始草稿的具体修订

| 原稿内容 | 正式版处理 |
| --- | --- |
| 单机/局域网定位 | 改为浏览器网站，明确 Pages 演示与真实协作 |
| Gradio 自带登录、SQLite | 改为外部认证和数据库；本地演示不宣传为安全登录 |
| 全部页面单列 | 评价员单列填写；管理员桌面采用适合数据管理的布局 |
| 初始 `admin123` | 取消；演示身份公开标识，真实管理员可信初始化 |
| 草稿是否需要待确认 | 本设计明确需要，加入保存状态与冲突处理 |
| 样品编号名称手动指定 | 保留；增加稳定 ID、前导零保护和名称可见开关 |
| “110”“710” 等不完整范围文字 | 明确 `min/max/step` 与无重叠档位规则，不照抄猜测 |
| 原三表配置 | 拆成五表，给出 Schema、正常和错误案例 |
| 提交后锁定、管理员退回 | 保留并补充不可变修订、幂等、时间窗与并发事务 |
| 单因素/双因素 ANOVA 混用 | 按重复测量定义统计单位和方法，不把相关评分当独立样本 |
| 默认 Tukey 和字母分组 | 改为明确的配对比较和 Holm，报告差值与校正 p；不把未显著解释为相等 |
| RMSE/相关筛除评价员 | 改为留一法评分模式复核，不自动剔除，不声称重测可靠性 |
| 一次性给完整文件即可 | 增加里程碑、部署、数据权限、验收和可追溯运行记录 |

## 4. 当前仓库事实

本轮开始时读取到的 `dev` 为 `d12898a649e3b49840b77577742e628ebe3fef1d`，默认分支是 `dev`，`main` 当时指向同一提交。仓库已有静态欢迎页、样式、许可、编辑和忽略规则，没有问卷业务实现，也没有产品测试入口。

原 README 记录 Pages 发布源为 `main / (root)`；本轮未直接读取或修改 Settings → Pages，因此不把该记录当成已经重新验证的当前设置。后续首次发布须实际核对。本文档加入 `dev` 不等于问卷系统已经上线。

仓库来源：[初始化提交](https://github.com/SiliconYC/questionnaire/commit/d12898a649e3b49840b77577742e628ebe3fef1d)、[原始 README](https://github.com/SiliconYC/questionnaire/blob/d12898a649e3b49840b77577742e628ebe3fef1d/README.md)。

## 5. 平台与技术资料

| 编号 | 来源 | 用于核对 |
| --- | --- | --- |
| GH1 | [GitHub · What is GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages) | 静态托管、项目站点地址 |
| GH2 | [GitHub · Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) | 敏感交易告诫、用途与配额边界 |
| GH3 | [GitHub · Configuring a publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) | 分支根目录或 docs、Pages 自身部署流程 |
| GH4 | [GitHub · HTTPS](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https) | HTTPS 与公开站点性质 |
| FE1 | [Vite · Static deployment](https://vite.dev/guide/static-deploy.html) | 项目路径 base 和静态产物 |
| AUTH1 | [Supabase · Passwordless email](https://supabase.com/docs/guides/auth/auth-email-passwordless) | OTP/Magic Link、注册行为、邮件模板 |
| AUTH2 | [Supabase · Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp) | 默认发信限制与正式发信配置 |
| AUTH3 | [Supabase · API keys](https://supabase.com/docs/guides/getting-started/api-keys) | publishable 与 secret key 区别 |
| AUTH4 | [Supabase · Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) | 服务端数据授权、角色与安全边界 |
| AUTH5 | [Supabase · Google sign-in](https://supabase.com/docs/guides/auth/social-sign-in/auth-google) | 可选外部 OAuth 的提供方配置 |
| AUTH6 | [Supabase · PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow) | 可选回调交换与同浏览器限制 |
| WEB1 | [MDN · Storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) | 本地浏览器存储不保证永久保留，按 origin 隔离 |
| WEB2 | [OWASP · CSV Injection](https://owasp.org/www-community/attacks/CSV_Injection) | 表格公式注入与转义的兼容性限制 |
| DATA1 | [RFC 8785 · JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785) | 确定性 JSON 表示与哈希输入 |
| DATA2 | [Ajv · multipleOfPrecision](https://ajv.js.org/options.html#multipleofprecision) | 小数除数的浮点误差；本项目把精确小数校验放在语义层 |

平台能力与套餐可能变化。实施时重新核实版本、配额、邮件限制与价格；本设计不承诺免费、永久在线或无限用户。Pages 调用外部 API 的技术可行性不等于对其所有真实用途的许可承诺。

## 6. 统计资料

| 编号 | 来源 | 用于核对 |
| --- | --- | --- |
| STAT1 | [NIST · Randomized block designs](https://www.itl.nist.gov/div898/handbook/pri/section3/pri332.htm) | 区组与处理效应模型，不替实际实验声称已随机化 |
| STAT2 | [Pingouin · rm_anova](https://pingouin-stats.org/generated/pingouin.rm_anova.html) | 重复测量、GG 参数、完整案例处理 |
| STAT3 | [R · quantile](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/quantile.html) | type 7 分位数 |
| STAT4 | [Pingouin · epsilon](https://pingouin-stats.org/generated/pingouin.epsilon.html) | GG 校正系数定义 |
| STAT5 | [statsmodels · AnovaRM](https://www.statsmodels.org/stable/generated/statsmodels.stats.anova.AnovaRM.html) | 支持平衡设计但不提供球形性违背校正的限制 |
| STAT6 | [SciPy · ttest_rel](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.ttest_rel.html) | 配对 t 检验与配对差置信区间 |
| STAT7 | [R · p.adjust](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/p.adjust.html) | Holm 家族错误率控制 |
| STAT8 | [emmeans · Compact letter displays](https://rvlenth.github.io/emmeans/reference/CLD.emmGrid.html) | 字母分组容易被误解为等效 |
| STAT9 | [SciPy · pearsonr](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.pearsonr.html) | 常数、近常数与少量配对点的限制 |

这些资料说明方法和工具能力，不证明当前实验已经满足统计假设。固定顺序、无重复场次、小样本与缺失问题必须写入实际分析说明。

## 7. 仓库工作规范

本轮核对了 `skill-kits/dev` 中的 [Git 分支工作流](https://github.com/SiliconYC/skill-kits/blob/dev/tenet/tenet-git-branch-workflow/SKILL.md)、[Markdown 格式](https://github.com/SiliconYC/skill-kits/blob/dev/tenet/tenet-markdown-format/SKILL.md)、[仓库测试门禁](https://github.com/SiliconYC/skill-kits/blob/dev/tenet/tenet-repository-test-gate/SKILL.md)、[Python 环境选择](https://github.com/SiliconYC/skill-kits/blob/dev/tenet/tenet-python-env-selection/SKILL.md) 与 [新仓库初始化](https://github.com/SiliconYC/skill-kits/blob/dev/tenet/tenet-github-repo-init/SKILL.md)。

仓库已经完成 `main/dev` 初始化，不重复初始化或覆盖 `main`。正式长期文档放 `docs/`；该仓库已忽略 `docs/superpowers`，不把应交付资料放入被忽略的临时目录。规范可能更新，后续 Agent 应以任务开始时实际适用的版本与用户明确指令为准。
