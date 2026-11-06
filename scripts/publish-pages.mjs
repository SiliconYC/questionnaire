import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, sep, join } from "node:path";
const root = process.cwd(),
  repo = "https://github.com/SiliconYC/questionnaire.git";
const git = (args, cwd = root) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const marker = JSON.parse(
  readFileSync(resolve(root, "dist/build.json"), "utf8"),
);
if (
  marker.mode !== "demo" ||
  marker.source_commit !== git(["rev-parse", "HEAD"])
)
  throw new Error(
    "请从当前已提交源码重新构建 demo，发布物必须有匹配的 build.json。",
  );
const release = resolve(root, ".cache/pages-release");
if (
  !release.startsWith(resolve(root, ".cache") + sep) ||
  !release.endsWith(sep + "pages-release")
)
  throw new Error("发布目录越界。");
mkdirSync(release, { recursive: true });
if (!existsSync(join(release, ".git"))) {
  git(["init"], release);
  git(["remote", "add", "origin", repo], release);
}
const branch = git(["ls-remote", "--heads", "origin", "gh-pages"]);
if (branch) {
  git(["fetch", "origin", "gh-pages"], release);
  git(["checkout", "-B", "gh-pages", "FETCH_HEAD"], release);
} else git(["checkout", "-B", "gh-pages"], release);
for (const name of readdirSync(release)) {
  if (name === ".git") continue;
  const target = resolve(release, name);
  if (!target.startsWith(release + sep)) throw new Error("发布文件越界。");
  rmSync(target, { recursive: true, force: true });
}
cpSync(resolve(root, "dist"), release, { recursive: true });
git(["add", "--all"], release);
if (!branch || git(["status", "--porcelain"], release))
  git(
    ["commit", "-m", "deploy: demo from " + marker.source_commit.slice(0, 12)],
    release,
  );
git(["push", "origin", "HEAD:gh-pages"], release);
console.log(
  JSON.stringify({
    source_commit: marker.source_commit,
    artifact_commit: git(["rev-parse", "HEAD"], release),
    url: "https://siliconyc.github.io/questionnaire/",
    mode: "demo",
  }),
);
