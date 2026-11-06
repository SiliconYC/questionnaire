import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DemoAdapter } from "../src/adapters/demo";
import type { Answers } from "../src/domain/types";

const key = () => crypto.randomUUID();
let adapter: DemoAdapter;
beforeEach(async () => {
  adapter = new DemoAdapter("demo-admin");
  await adapter.initialize();
  await adapter.execute("reset", {});
});
async function call(action: string, input: any = {}) {
  const result = await adapter.execute(action, {
    idempotency_key: key(),
    ...input,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data;
}
async function setup() {
  const state = await adapter.read();
  const e = state.experiments.find((e) => e.experiment_id === "demo-open")!;
  const a = state.assignments.find(
    (a) => a.experiment_id === e.experiment_id && a.user_id === "demo-p1",
  )!;
  adapter.setActor("demo-p1");
  await call("acceptNotice", {
    assignment_id: a.assignment_id,
    config_version_id: e.config_version_id,
    privacy_notice_version: a.privacy_notice_version,
  });
  const answers: Answers = {
    numeric: e.config.indicators.map((i) => ({
      indicator_id: i.indicator_id,
      value: i.min,
      missing_reason: null,
    })),
    text: e.config.text_questions.map((t) => ({
      text_question_id: t.text_question_id,
      value: "评价",
    })),
  };
  return {
    e,
    a,
    answers,
    input: {
      assignment_id: a.assignment_id,
      sample_id: e.config.samples[0].sample_id,
      config_version_id: e.config_version_id,
      answers,
      expected_version: 0,
    },
  };
}
describe("IndexedDB domain transactions", () => {
  it("persists and projects only the actor data and public sample fields", async () => {
    adapter.setActor("demo-p1");
    const s = await adapter.read();
    expect(s.profiles.map((p) => p.user_id)).toEqual(["demo-p1"]);
    expect(s.assignments.every((a) => a.user_id === "demo-p1")).toBe(true);
    expect(JSON.stringify(s)).not.toContain("admin_name");
    expect(s.snapshots).toEqual([]);
    const other = new DemoAdapter("demo-admin");
    await other.initialize();
    expect((await other.read()).experiments.length).toBe(3);
  });
  it("requires consent, rejects cross-user writes and stale versions", async () => {
    const s = await adapter.read(),
      a = s.assignments.find((a) => a.user_id === "demo-p1")!,
      e = s.experiments.find((e) => e.experiment_id === a.experiment_id)!;
    adapter.setActor("demo-p2");
    expect(
      (
        await adapter.execute("saveDraft", {
          assignment_id: a.assignment_id,
          idempotency_key: key(),
        })
      ).ok,
    ).toBe(false);
    adapter.setActor("demo-p1");
    expect(
      await adapter.execute("saveDraft", {
        assignment_id: a.assignment_id,
        config_version_id: e.config_version_id,
        sample_id: e.config.samples[0].sample_id,
        answers: { numeric: [], text: [] },
        expected_version: 0,
        idempotency_key: key(),
      }),
    ).toMatchObject({ ok: false, error: { code: "CONSENT_REQUIRED" } });
    const { input } = await setup();
    await call("saveDraft", input);
    expect(
      await adapter.execute("saveDraft", { ...input, idempotency_key: key() }),
    ).toMatchObject({
      ok: false,
      error: { code: "VERSION_CONFLICT", latest_version: 1 },
    });
  });
  it("replays exactly once, rejects key conflicts and preserves immutable returned revisions", async () => {
    const { input } = await setup(),
      idempotency_key = key();
    const first = await call("submit", { ...input, idempotency_key });
    const replay = await call("submit", { ...input, idempotency_key });
    expect(replay).toEqual(first);
    expect(
      await adapter.execute("submit", {
        ...input,
        answers: { numeric: [], text: [] },
        idempotency_key,
      }),
    ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
    adapter.setActor("demo-admin");
    await call("returnResponse", {
      response_id: first.response_id,
      reason: "请复核",
      expected_version: 1,
    });
    adapter.setActor("demo-p1");
    const saved = await call("saveDraft", { ...input, expected_version: 2 });
    expect(saved.state).toBe("returned");
    const next = await call("submit", { ...input, expected_version: 3 });
    expect(next.revision_no).toBe(2);
    adapter.setActor("demo-admin");
    const s = await adapter.read();
    expect(
      s.revisions.filter((r) => r.response_id === first.response_id),
    ).toHaveLength(2);
    expect(
      s.revisions.find((r) => r.revision_id === first.revision_id)?.answers,
    ).toEqual(input.answers);
  });
  it("captures consistent snapshots and increments data revision only on coverage changes", async () => {
    const { input, e, a } = await setup();
    await call("saveDraft", input);
    adapter.setActor("demo-admin");
    let s = await adapter.read(),
      revision = s.experiments.find(
        (x) => x.experiment_id === e.experiment_id,
      )!.data_revision;
    adapter.setActor("demo-p1");
    await call("saveDraft", { ...input, expected_version: 1 });
    adapter.setActor("demo-admin");
    expect(
      (await adapter.read()).experiments.find(
        (x) => x.experiment_id === e.experiment_id,
      )!.data_revision,
    ).toBe(revision);
    adapter.setActor("demo-p1");
    await call("submit", { ...input, expected_version: 2 });
    adapter.setActor("demo-admin");
    s = await adapter.read();
    revision = s.experiments.find(
      (x) => x.experiment_id === e.experiment_id,
    )!.data_revision;
    const snapshot = await call("createSnapshot", {
      experiment_id: e.experiment_id,
      expected_data_revision: revision,
    });
    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.input_hash).toHaveLength(64);
    await call("setAssignmentState", {
      assignment_id: a.assignment_id,
      state: "revoked",
      reason: "撤销",
      expected_version: 1,
    });
    expect(
      await adapter.execute("createSnapshot", {
        experiment_id: e.experiment_id,
        expected_data_revision: revision,
        idempotency_key: key(),
      }),
    ).toMatchObject({ ok: false, error: { code: "DATA_CHANGED" } });
    const frozen = (await adapter.read()).snapshots.find(
      (x) => x.snapshot_id === snapshot.snapshot_id,
    )!;
    expect(frozen.rows).toHaveLength(1);
    await call("setAssignmentState", {
      assignment_id: a.assignment_id,
      state: "active",
      reason: "恢复",
      expected_version: 2,
    });
    expect(
      (await adapter.read()).assignments.find(
        (x) => x.assignment_id === a.assignment_id,
      )!.assignment_id,
    ).toBe(a.assignment_id);
  });
  it("serializes simultaneous initial submissions and enforces closure", async () => {
    const { input, e } = await setup();
    const results = await Promise.all([
      adapter.execute("submit", { ...input, idempotency_key: key() }),
      adapter.execute("submit", { ...input, idempotency_key: key() }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    adapter.setActor("demo-admin");
    await call("transition", {
      experiment_id: e.experiment_id,
      target: "closed",
      reason: "结束",
      expected_version: e.edit_version,
    });
    adapter.setActor("demo-p1");
    expect(
      await adapter.execute("saveDraft", {
        ...input,
        sample_id: e.config.samples[1].sample_id,
        idempotency_key: key(),
      }),
    ).toMatchObject({ ok: false, error: { code: "EXPERIMENT_NOT_OPEN" } });
  });
  it("rejects unknown mutation fields, malformed versions and forged actor metadata", async () => {
    const { input } = await setup();
    expect(
      await adapter.execute("submit", {
        ...input,
        submitted_by: "demo-admin",
        idempotency_key: key(),
      }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(
      await adapter.execute("submit", {
        ...input,
        idempotency_key: "not-a-uuid",
      }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
  });
  it("enforces exclusive close and inclusive opening boundaries at each write", async () => {
    const { e, answers } = await setup();
    adapter.setActor("demo-admin");
    const config = structuredClone(e.config);
    config.experiment.opens_at = "2099-01-01T00:00:00Z";
    config.experiment.closes_at = "2099-02-01T00:00:00Z";
    const draft = await call("createDraft", { config });
    const published = await call("publish", {
      experiment_id: draft.experiment_id,
      expected_version: 1,
    });
    const assigned = await call("assign", {
      experiment_id: draft.experiment_id,
      user_ids: ["demo-p1"],
    });
    const a = assigned.assignments[0];
    adapter.setActor("demo-p1");
    await call("acceptNotice", {
      assignment_id: a.assignment_id,
      config_version_id: published.config_version_id,
      privacy_notice_version: a.privacy_notice_version,
    });
    expect(
      await adapter.execute("submit", {
        assignment_id: a.assignment_id,
        config_version_id: published.config_version_id,
        sample_id: config.samples[0].sample_id,
        answers,
        expected_version: 0,
        idempotency_key: key(),
      }),
    ).toMatchObject({ ok: false, error: { code: "EXPERIMENT_NOT_OPEN" } });
  });
  it("accepts the exact opening instant and rejects the exact close instant", async () => {
    const { e, answers } = await setup();
    adapter.setActor("demo-admin");
    const config = structuredClone(e.config);
    const now = Date.now();
    config.experiment.opens_at = new Date(now + 10000).toISOString();
    config.experiment.closes_at = new Date(now + 20000).toISOString();
    const draft = await call("createDraft", { config });
    const published = await call("publish", {
      experiment_id: draft.experiment_id,
      expected_version: 1,
    });
    const a = (
      await call("assign", {
        experiment_id: draft.experiment_id,
        user_ids: ["demo-p1"],
      })
    ).assignments[0];
    adapter.setActor("demo-p1");
    await call("acceptNotice", {
      assignment_id: a.assignment_id,
      config_version_id: published.config_version_id,
      privacy_notice_version: a.privacy_notice_version,
    });
    const input = {
      assignment_id: a.assignment_id,
      config_version_id: published.config_version_id,
      sample_id: config.samples[0].sample_id,
      answers,
      expected_version: 0,
    };
    const clock = vi.spyOn(Date, "now");
    try {
      clock.mockReturnValue(now + 10000);
      expect(
        (
          await adapter.execute("saveDraft", {
            ...input,
            idempotency_key: key(),
          })
        ).ok,
      ).toBe(true);
      clock.mockReturnValue(now + 20000);
      expect(
        await adapter.execute("submit", {
          ...input,
          expected_version: 1,
          idempotency_key: key(),
        }),
      ).toMatchObject({ ok: false, error: { code: "EXPERIMENT_NOT_OPEN" } });
    } finally {
      clock.mockRestore();
    }
  });
  it("blocks replay access after task revocation without creating a revision", async () => {
    const { input, a } = await setup();
    const idempotency_key = key();
    await call("submit", { ...input, idempotency_key });
    adapter.setActor("demo-admin");
    await call("setAssignmentState", {
      assignment_id: a.assignment_id,
      state: "revoked",
      reason: "撤销",
      expected_version: 1,
    });
    adapter.setActor("demo-p1");
    expect(
      await adapter.execute("submit", { ...input, idempotency_key }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    adapter.setActor("demo-admin");
    expect(
      (await adapter.read()).revisions.filter(
        (r) =>
          r.submitted_by === "demo-p1" &&
          r.config_version_id === input.config_version_id,
      ),
    ).toHaveLength(1);
  });
  it("freezes the exclusion list for old revisions in each snapshot", async () => {
    const { input, e } = await setup();
    const receipt = await call("submit", input);
    adapter.setActor("demo-admin");
    await call("returnResponse", {
      response_id: receipt.response_id,
      reason: "复核",
      expected_version: 1,
    });
    adapter.setActor("demo-p1");
    await call("submit", { ...input, expected_version: 2 });
    adapter.setActor("demo-admin");
    const revision = (await adapter.read()).experiments.find(
      (x) => x.experiment_id === e.experiment_id,
    )!.data_revision;
    const snap = await call("createSnapshot", {
      experiment_id: e.experiment_id,
      expected_data_revision: revision,
    });
    expect(snap.excluded_revisions).toContainEqual({
      response_id: receipt.response_id,
      revision_id: receipt.revision_id,
      reason: "OLD_REVISION",
    });
  });
  it("makes disablement immediately block writes and stale analysis", async () => {
    const { input, e } = await setup();
    await call("submit", input);
    adapter.setActor("demo-admin");
    const before = (await adapter.read()).experiments.find(
      (x) => x.experiment_id === e.experiment_id,
    )!.data_revision;
    await call("setProfileState", {
      user_id: "demo-p1",
      state: "disabled",
      reason: "停用",
      expected_version: 1,
    });
    const snapshot = await call("createSnapshot", {
      experiment_id: e.experiment_id,
      expected_data_revision: before + 1,
    });
    expect(snapshot.rows).toEqual([]);
    expect(
      snapshot.coverage.some((c: any) => c.reason === "ACCOUNT_DISABLED"),
    ).toBe(true);
    adapter.setActor("demo-p1");
    expect(
      await adapter.execute("submit", { ...input, idempotency_key: key() }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    adapter.setActor("demo-admin");
    expect(
      await adapter.execute("setProfileState", {
        user_id: "demo-admin",
        state: "disabled",
        reason: "test",
        expected_version: 1,
        idempotency_key: key(),
      }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
  it("atomically rejects bad batches and freezes published configs", async () => {
    const s = await adapter.read(),
      e = s.experiments.find((e) => e.experiment_id === "demo-open")!;
    const before = s.assignments.length;
    expect(
      await adapter.execute("assign", {
        experiment_id: e.experiment_id,
        user_ids: ["demo-p1", "missing"],
        idempotency_key: key(),
      }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect((await adapter.read()).assignments).toHaveLength(before);
    expect(
      await adapter.execute("updateDraft", {
        experiment_id: e.experiment_id,
        config: e.config,
        expected_version: 1,
        idempotency_key: key(),
      }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
  it("persists a draft with two empty sample codes but blocks publication", async () => {
    const config = structuredClone(
      (await adapter.read()).experiments.find(
        (e) => e.experiment_id === "demo-draft",
      )!.config,
    );
    config.samples[0].code = "";
    config.samples[1].code = "  ";
    const created = await call("createDraft", { config });
    expect(created.publish_issues.length).toBeGreaterThan(0);
    expect(
      (await adapter.read()).experiments.find(
        (e) => e.experiment_id === created.experiment_id,
      )?.config.samples[0].code,
    ).toBe("");
    expect(
      await adapter.execute("publish", {
        experiment_id: created.experiment_id,
        expected_version: 1,
        idempotency_key: key(),
      }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
  });
  it("rejects the 101st evaluator instead of truncating assignment lists", async () => {
    const user_ids: string[] = [];
    for (let n = 0; n < 98; n++)
      user_ids.push(
        (await call("createIdentity", { display_name: "合成评价员" + n }))
          .user_id,
      );
    await call("assign", {
      experiment_id: "demo-open",
      user_ids: user_ids.slice(0, 97),
    });
    expect(
      await adapter.execute("assign", {
        experiment_id: "demo-open",
        user_ids: user_ids.slice(97),
        idempotency_key: key(),
      }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(
      (await adapter.read()).assignments.filter(
        (a) => a.experiment_id === "demo-open",
      ),
    ).toHaveLength(100);
  });
});
