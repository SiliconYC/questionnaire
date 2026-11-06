# Questionnaire

用于后续建设问卷网站的开源仓库。当前仅包含静态欢迎页，不提供问卷填写、提交或数据存储功能。

- 网站：https://siliconyc.github.io/questionnaire/
- 仓库：https://github.com/SiliconYC/questionnaire
- 许可：[MIT](LICENSE)

## 项目结构

- `index.html`：网站入口
- `assets/styles.css`：响应式页面样式
- `.nojekyll`：使用原生静态文件，不经过 Jekyll
- `.editorconfig`：基础编辑规范
- `.gitignore`：忽略本地依赖、环境文件和日志

## 本地预览

无需安装前端依赖。安装 Python 3 后，在仓库根目录运行：

```sh
python -m http.server 8000
```

然后打开 http://localhost:8000 。也可直接在浏览器中打开 `index.html`。

## GitHub Pages

发布方式为 **Deploy from a branch**，源分支 **main**，目录 **/ (root)**。
推送到 main 后，GitHub 会自动部署更新；部署结果可在仓库 Actions 和 Settings → Pages 中查看。

项目站点路径为 `/questionnaire/`。静态资源使用相对路径，以兼容 GitHub Pages 项目站点。

## 后续开发

问卷字段、填写流程、提交方式及数据存储将在后续确定。GitHub Pages 仅托管静态网站，不会自动提供后端或收集回答。

接入真实数据收集前，请明确用途、告知与同意、访问权限、保存期限及删除方式。不要将回答、个人资料、密码或 API 密钥提交到此公开仓库；需要保密的密钥必须保留在服务端。
