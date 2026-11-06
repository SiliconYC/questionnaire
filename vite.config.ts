import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  const appMode =
    env.VITE_APP_MODE ??
    (mode === "live" ? "live" : mode === "demo" ? "demo" : undefined);
  if (!appMode || !["demo", "live"].includes(appMode))
    throw new Error(
      "请显式设置 VITE_APP_MODE=demo 或 live（或使用 --mode demo/live）。",
    );
  if (
    appMode === "live" &&
    (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_PUBLISHABLE_KEY)
  )
    throw new Error(
      "真实模式缺少 Supabase URL / publishable key，不能回退演示。",
    );
  const sourceCommit =
    env.BUILD_SHA ??
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  return {
    plugins: [
      react(),
      {
        name: "build-provenance",
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "build.json",
            source: JSON.stringify({
              source_commit: sourceCommit,
              mode: appMode,
              built_at: new Date().toISOString(),
            }),
          });
        },
      },
    ],
    base: "/questionnaire/",
    define: {
      __APP_MODE__: JSON.stringify(appMode),
      __BUILD_SHA__: JSON.stringify(sourceCommit),
    },
    server: {
      port: 23090,
      strictPort: true,
      watch: { ignored: ["**/本地测试留痕/**", "**/.superpowers/**"] },
    },
    preview: { port: 23090, strictPort: true },
    build: { target: "es2022", chunkSizeWarningLimit: 1000 },
  };
});
