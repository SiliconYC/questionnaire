# Questionnaire · 感官评价问卷系统

用于建设中文感官评价问卷网站：管理员设计实验与分配任务，评价员逐样品填写，管理员汇总分析并导出。

**当前阶段：正式开发文档已建立，网站仍是静态欢迎页。** 注册、问卷、数据库与分析功能尚未实现，不把下述设计目标当成已上线能力。

- [网站入口](https://siliconyc.github.io/questionnaire/)
- [GitHub 仓库](https://github.com/SiliconYC/questionnaire)
- [正式开发文档总索引](docs/README.md)
- [MIT 许可](LICENSE)

## 开发文档

| 想了解什么 | 从这里开始 |
| --- | --- |
| 做什么、做到什么程度 | [产品需求](docs/01-product-requirements.md) |
| 页面如何使用、怎样组织代码 | [页面与交互](docs/02-user-experience.md)、[技术架构](docs/03-architecture.md) |
| 数据、接口和配置如何对齐 | [数据模型](docs/04-data-model.md)、[服务接口](docs/05-api-contracts.md)、[配置格式](docs/06-configuration-format.md) |
| 怎样计算、怎样保护真实数据 | [统计分析](docs/07-statistical-analysis.md)、[认证与隐私](docs/08-security-and-privacy.md) |
| 下一位 Agent 如何落地 | [部署与运行](docs/09-deployment-and-operations.md)、[实现计划](docs/10-implementation-plan.md)、[验收标准](docs/11-acceptance-tests.md) |
| 为什么这样选 | [决策与资料](docs/12-decisions-and-references.md) |

机器可读材料在 `docs/contracts/` 和 `docs/examples/`，包含配置 Schema、合法配置、非法案例与统计核对数据，全部为人工构造示例。

## 交付路线

| 阶段 | 目标 |
| --- | --- |
| M1 · 完整演示 | GitHub Pages 上可实际操作的实验管理、填写、浏览器保存、描述统计和下载；身份明确标为演示 |
| M2 · 真实协作 | 同一前端接入外部认证和数据库，提供真实注册、权限及跨设备共享；正式登录应用的承载边界见部署文档 |
| M3 · 进阶分析 | 经核对的重复测量分析、配对比较、评分模式复核及可追溯报告 |

演示模式和真实模式共享业务接口，数据彼此隔离。真实服务故障不得静默回退演示，不得用假回执或假统计值宣称成功。

## 当前项目结构与预览

- `index.html`、`assets/styles.css`：现有静态欢迎页，可直接用浏览器打开 `index.html` 预览。
- `.nojekyll`：现有原生静态发布标记。
- `docs/`：长期维护的正式需求、设计、实现与验收资料。

当前没有 `package.json` 或前端构建脚本；文档中的 pnpm 命令由后续 T01 建立后才能使用。需要 HTTP 预览时使用已有合规环境中的静态服务器，不为预览擅自创建或修改 Python 环境。

## 分支与发布

默认开发分支为 `dev`；从 `dev` 派生临时分支，经 PR 合回。`main` 保持冷分支。

初始化 README 曾记录 Pages 发布源为 `main / (root)`，当前设置应以 Settings → Pages 实际值为准。本轮只加入开发文档，没有修改 Pages 设置。未来应用发布计划使用本地构建及专用 `gh-pages` 分支根目录，项目路径为 `/questionnaire/`，详见 [部署与运行](docs/09-deployment-and-operations.md)。

真实答卷、身份资料、服务端密钥和数据库导出不得提交到此公开仓库。实施前先读 [文档索引](docs/README.md)，按里程碑交付实际地址、提交与验证结果。
