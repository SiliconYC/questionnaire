import { test, expect } from "@playwright/test";
test("访客可从首页进入管理与本人任务，手机没有页面横向溢出", async ({
  page,
}) => {
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: /让每一份感受，.*都有据可循。/ }),
  ).toBeVisible();
  await page.getByRole("link", { name: "体验演示", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "实验工作台", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".demo-bar")).toBeVisible();
  await page.getByLabel("切换演示身份").selectOption("demo-p1");
  await expect(
    page.getByRole("heading", { name: "我的评价任务", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
test("评价空值无默认分数，保存刷新恢复，提交取得回执", async ({ page }) => {
  await page.goto("./#/admin");
  await page.getByLabel("切换演示身份").selectOption("demo-p1");
  await page.getByRole("link", { name: "开始评价" }).first().click();
  await page.getByLabel("我已阅读实验说明与演示数据告知").check();
  await page.getByRole("button", { name: "同意并开始评价" }).click();
  await page.getByRole("link", { name: /评价样品 001/ }).click();
  const scores = page.locator("input[type=number]");
  await scores.first().waitFor({ state: "visible" });
  await expect(scores.first()).toHaveValue("");
  for (let i = 0; i < (await scores.count()); i++)
    await scores.nth(i).fill(i === 0 ? "7.5" : i === 1 ? "0" : "6");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "已保存到本浏览器" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator("input[type=number]").first()).toHaveValue("7.5");
  await page.getByRole("button", { name: "提交此样品", exact: true }).click();
  await page.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "提交成功", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("修订 1", { exact: false })).toBeVisible();
});
test("创建示例实验并保存草稿，发布冻结，批量分配", async ({ page }) => {
  await page.goto("./#/admin/experiments/new");
  await page.getByRole("button", { name: "填入示例配置", exact: true }).click();
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "烘焙样品感官评价 · 示例", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "继续设计", exact: true }).click();
  await page.getByRole("button", { name: "预览发布" }).click();
  await page.getByRole("button", { name: "发布实验", exact: true }).click();
  await page.getByRole("button", { name: "确认发布", exact: true }).click();
  await expect(
    page.getByText("实验已发布，配置已锁定。现在可以分配评价员。"),
  ).toBeVisible();
  await page.getByRole("button", { name: "人员与进度", exact: true }).click();
  await page.locator(".participant-picks input").nth(1).check();
  await page
    .getByRole("button", { name: "分配所选评价员（1）", exact: true })
    .click();
  await expect(page.getByText("评价任务已分配。")).toBeVisible();
});

test("文字修改后立即离开路由，刷新后仍能恢复最新草稿", async ({ page }) => {
  await page.goto("./#/admin");
  await page.getByLabel("切换演示身份").selectOption("demo-p1");
  await page.getByRole("link", { name: "开始评价" }).first().click();
  await page.getByLabel("我已阅读实验说明与演示数据告知").check();
  await page.getByRole("button", { name: "同意并开始评价" }).click();
  await page.getByRole("link", { name: "评价样品 001" }).click();
  await page
    .getByLabel("其他意见", { exact: true })
    .fill("离开前的最后一条意见 🌿");
  await page.locator('a[href="#/tasks"]:visible').first().click();
  await expect(
    page.getByRole("heading", { name: "我的评价任务", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("link", { name: "开始评价" }).first().click();
  await page.getByRole("link", { name: "评价样品 001" }).click();
  await expect(page.getByLabel("其他意见", { exact: true })).toHaveValue(
    "离开前的最后一条意见 🌿",
  );
});
test("两个标签编辑实验，旧配置不能借新版本覆盖", async ({ page, context }) => {
  await page.goto("./#/admin/experiments/demo-draft/edit");
  const other = await context.newPage();
  await other.goto("./#/admin/experiments/demo-draft/edit");
  await page
    .getByLabel("实验名称 *", { exact: true })
    .fill("来自第一个标签的更新");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "来自第一个标签的更新", exact: true }),
  ).toBeVisible();
  await other
    .getByLabel("实验名称 *", { exact: true })
    .fill("旧标签的冲突更新");
  await other.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(other.getByRole("alert")).toContainText("已更新");
  await other.close();
});
test("分析快照产生真实图表与七表Excel下载，深链接刷新可用", async ({
  page,
}, testInfo) => {
  await page.goto("./#/admin/experiments/demo-closed");
  await page.getByRole("button", { name: "分析与导出", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "感受，开始成为洞察", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "描述统计数值表", exact: true }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "下载完整 Excel", exact: true })
    .click();
  const file = await download;
  const target = testInfo.outputPath("results.xlsx");
  await file.saveAs(target);
  const ExcelJS = (await import("exceljs")).default;
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(target);
  expect(book.worksheets.map((s) => s.name)).toEqual([
    "导出说明",
    "数值明细",
    "文字明细",
    "描述统计",
    "任务覆盖",
    "实验配置",
    "推断分析",
  ]);
  expect(book.getWorksheet("数值明细")!.rowCount).toBeGreaterThan(1);
  await page.getByRole("button", { name: "指标分布", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "评分分布 · 箱线图", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: testInfo.outputPath("analysis.png"),
    fullPage: true,
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "合成数据 · 已关闭实验", exact: true }),
  ).toBeVisible();
});
test("JSON导入先预览确认，保留小数网格与编码文本", async ({ page }) => {
  await page.goto("./#/admin/experiments/new");
  await page
    .locator("input[type=file]")
    .setInputFiles("docs/examples/decimal-grid-valid.json");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("button", { name: "确认使用此配置", exact: true })
    .click();
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("小数");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
test("退回后修改重交生成修订2，文字按原文显示", async ({ page }) => {
  await page.goto("./#/admin");
  await page.getByLabel("切换演示身份").selectOption("demo-p1");
  await page.getByRole("link", { name: "开始评价" }).first().click();
  await page.getByLabel("我已阅读实验说明与演示数据告知").check();
  await page.getByRole("button", { name: "同意并开始评价" }).click();
  await page.getByRole("link", { name: "评价样品 001" }).click();
  const scores = page.locator("input[type=number]");
  await scores.first().waitFor({ state: "visible" });
  for (let k = 0; k < (await scores.count()); k++)
    await scores.nth(k).fill(k === 0 ? "7.5" : k === 1 ? "0" : "6");
  await page
    .getByLabel("其他意见", { exact: true })
    .fill("<script>window.unwanted=true</script> 原文 🌿");
  await page.getByRole("button", { name: "提交此样品", exact: true }).click();
  await page.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "提交成功", exact: true }),
  ).toBeVisible();
  await page.getByLabel("切换演示身份").selectOption("demo-admin");
  await page
    .getByRole("heading", { name: "茶饮感官评价 · 开放演示", exact: true })
    .getByRole("link")
    .click();
  await page.getByRole("button", { name: "评价记录", exact: true }).click();
  await page.getByRole("button", { name: "退回修改", exact: true }).click();
  await page.getByLabel("操作原因 *").fill("请重新核对样品色泽");
  await page.getByRole("button", { name: "确认操作", exact: true }).click();
  await expect(page.getByText("操作已完成。")).toBeVisible();
  await page.getByLabel("切换演示身份").selectOption("demo-p1");
  await page.getByRole("link", { name: "开始评价" }).first().click();
  await page.getByRole("link", { name: "评价样品 001" }).click();
  await expect(page.getByText("原因：请重新核对样品色泽")).toBeVisible();
  await page.locator("input[type=number]").first().fill("8");
  await page.getByRole("button", { name: "提交此样品", exact: true }).click();
  await page.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(
    page.getByText("样品 001 · 修订 2", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "查看只读答卷", exact: true }).click();
  await expect(
    page.getByText("<script>window.unwanted=true</script> 原文 🌿", {
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => Boolean((window as any).unwanted)),
  ).toBeFalsy();
  await expect(page.getByLabel("选择提交修订").locator("option")).toHaveCount(
    2,
  );
});
