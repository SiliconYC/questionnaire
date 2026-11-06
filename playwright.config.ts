import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "本地测试留痕/浏览器/验收",
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:23090/questionnaire/",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chrome-desktop",
      use: { channel: "chrome", viewport: { width: 1440, height: 1000 } },
    },
    {
      name: "edge-mobile-360",
      use: {
        channel: "msedge",
        viewport: { width: 360, height: 800 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "chrome-mobile-390",
      use: {
        channel: "chrome",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
