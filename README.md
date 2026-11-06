# Questionnaire · 知味感官评价工作台

中文感官评价网站，覆盖实验设计、任务分配、逐样品评价、草稿保存、退回修订、描述统计及文件下载。

- [在线演示](https://siliconyc.github.io/questionnaire/)
- [正式需求与契约](docs/README.md)
- [真实服务接入](docs/live-setup.md)
- [交付与验证记录](docs/delivery.md)

## 运行方式

需要 `Node.js 22.20.0` 或兼容版本；固定包管理器为 `pnpm 10.20.0`，通过 `Corepack` 使用。

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm dev --mode demo
corepack pnpm test
corepack pnpm test:e2e
corepack pnpm build --mode demo
```

浏览器入口为 `http://127.0.0.1:23090/questionnaire/`。固定端口 `23090`，备用 `23091–23099`，已登记共享端口表；不结束身份不明的占用进程。开发与生产预览不同时运行。

`pnpm test:e2e` 使用已安装的 Chrome、Edge，分别验证 `1440px`、`390px` 与 `360px`。测试截图、下载、报告在被忽略的 `本地测试留痕/`。

## 在线演示如何使用

1. 点击“体验演示”，以演示管理员进入工作台。
2. 打开开放实验，或创建实验、发布、在“人员与进度”中分配评价员。
3. 右上角切换评价员，进入“我的评价任务”，接受告知后逐样品填写。分数初始为空，停止输入 `800ms` 后自动保存。
4. 返回管理员查看进度与记录，可填写原因退回。重新提交会生成新修订，历史保留。
5. 在“分析与导出”创建冻结快照，查看统计及图表，下载 Excel、数值 CSV、文字 CSV。配置可用 JSON / Excel 导入导出。

电脑和手机都能访问同一网站，但演示数据只保存在各自浏览器的 `IndexedDB`，不能跨设备同步。身份是公开的演示身份，不是真实登录。重置演示或清理浏览器数据会丢失本地记录。

## 交付边界

- `M1`：完整可操作演示，含浏览器保存、配置向导、JSON/Excel 校验、分配、同意、评分、回执、退回、快照、真实描述统计及下载。
- `M2`：真实 OTP 入口、服务适配器、复用业务界面、数据库迁移、授权 RPC、受控清理和配置手册已准备。没有已配置的 Supabase、SMTP、独立真实站点及负责人，尚未进行真实认证、权限及跨设备验收。默认就绪开关为关闭。
- `M3`：受控统计服务未部署，进阶推断未启用。页面和导出只给出准确的未提供说明，不生成假 p 值或显著性。

真实模式只在独立 HTTPS 来源运行。构建时显式选择 `live` 并提供真实公开配置，缺配置直接失败，不回退本地演示；详见接入文档。真实名单、答卷与服务端秘密不得进入公开仓库。

## 发布与回滚

源码开发分支为 `dev`，通过功能分支 PR 合并；`main` 保持冷分支。Pages 静态产物使用 `gh-pages / (root)`，Vite 基路径为 `/questionnaire/`，应用使用哈希路由。

```powershell
corepack pnpm test
corepack pnpm test:e2e
corepack pnpm build --mode demo
node scripts/publish-pages.mjs
```

发布脚本检查产物的 `build.json` 与源提交一致，只推送演示静态产物。每次产物提交保留历史，可将先前已验证的产物重新提交到 `gh-pages` 回滚；回滚前端不会重置浏览器或真实数据库。
