import example from "../../../docs/examples/experiment-valid.json";
import { normalizeConfig } from "../../domain/validation";
import type { AppState, Experiment } from "../../domain/types";

export function seedState(): AppState {
  const now = new Date().toISOString();
  const config = normalizeConfig(example);
  config.experiment.opens_at = null;
  config.experiment.closes_at = null;
  const experiment = (
    id: string,
    title: string,
    status: Experiment["status"],
  ): Experiment => ({
    experiment_id: id,
    status,
    config: {
      ...structuredClone(config),
      experiment: { ...config.experiment, title },
    },
    config_version_id: status === "draft" ? null : id + "-v1",
    edit_version: 1,
    data_revision: 1,
    published_at: status === "draft" ? null : now,
    closed_at: status === "closed" ? now : null,
    created_at: now,
    privacy_notice_version: "demo-notice-v1",
  });
  const state: AppState = {
    profiles: [
      {
        user_id: "demo-admin",
        display_name: "演示管理员",
        participant_code: "ADMIN",
        role: "admin",
        state: "active",
        edit_version: 1,
      },
      ...[1, 2, 3].map((n) => ({
        user_id: "demo-p" + n,
        display_name: "演示评价员 " + n,
        participant_code: "P00" + n,
        role: "participant" as const,
        state: "active" as const,
        edit_version: 1,
      })),
    ],
    experiments: [
      experiment("demo-open", "茶饮感官评价 · 开放演示", "published"),
      experiment("demo-draft", "新实验草稿", "draft"),
      experiment("demo-closed", "合成数据 · 已关闭实验", "closed"),
    ],
    assignments: [],
    responses: [],
    revisions: [],
    snapshots: [],
    audit_events: [],
  };
  for (const e of state.experiments.filter((e) => e.status !== "draft"))
    for (let n = 1; n <= 3; n++) {
      const id = e.experiment_id + "-p" + n;
      state.assignments.push({
        assignment_id: id,
        experiment_id: e.experiment_id,
        user_id: "demo-p" + n,
        state: "active",
        edit_version: 1,
        consented_at: e.status === "closed" ? now : null,
        config_version_id: e.config_version_id!,
        privacy_notice_version: "demo-notice-v1",
        created_at: now,
      });
      if (e.status === "closed")
        for (const [j, sample] of e.config.samples.entries()) {
          const response_id = id + "-" + sample.sample_id,
            revision_id = response_id + "-r1";
          const answers = {
            numeric: e.config.indicators.map((i, k) => ({
              indicator_id: i.indicator_id,
              value: Math.min(
                i.max,
                i.min +
                  Math.round(
                    ((i.max - i.min) / i.step) *
                      (0.4 + ((n + j + k) % 4) * 0.1),
                  ) *
                    i.step,
              ),
              missing_reason: null,
            })),
            text: e.config.text_questions.map((t) => ({
              text_question_id: t.text_question_id,
              value: "合成演示评语，用于展示功能。",
            })),
          };
          for (const a of answers.numeric) a.value = Number(a.value.toFixed(2));
          state.responses.push({
            response_id,
            assignment_id: id,
            sample_id: sample.sample_id,
            state: "submitted",
            draft_answers: answers,
            edit_version: 1,
            latest_revision_id: revision_id,
            returned_reason: null,
            saved_at: now,
          });
          state.revisions.push({
            response_id,
            revision_id,
            revision_no: 1,
            submitted_at: now,
            edit_version: 1,
            answers: structuredClone(answers),
            config_version_id: e.config_version_id!,
            submitted_by: "demo-p" + n,
            idempotency_key: "seed-" + response_id,
          });
        }
    }
  return state;
}
