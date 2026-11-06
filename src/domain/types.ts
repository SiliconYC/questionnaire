export interface Issue {
  path: string;
  code: string;
  message: string;
  sheet?: string;
  cell?: string;
}
export interface Anchor {
  label: string;
  from: number;
  to: number;
}
export interface Indicator {
  indicator_id: string;
  category: string;
  label: string;
  description: string;
  kind: "continuous" | "anchored";
  min: number;
  max: number;
  step: number;
  required: boolean;
  allow_not_evaluable: boolean;
  direction: "higher_better" | "lower_better" | "neutral";
  analysis_scale: "interval" | "ordinal";
  anchors: Anchor[];
}
export interface ExperimentConfig {
  schema_version: "1.0.0";
  experiment: {
    title: string;
    description: string;
    instructions: string;
    time_zone: "Asia/Shanghai";
    opens_at: string | null;
    closes_at: string | null;
    display_sample_names: boolean;
    design: "within_subject_complete";
    sample_order: "fixed";
  };
  samples: {
    sample_id: string;
    code: string;
    admin_name?: string;
    display_name?: string;
  }[];
  indicators: Indicator[];
  text_questions: {
    text_question_id: string;
    label: string;
    description: string;
    required: boolean;
    max_length: number;
  }[];
}
export type DraftExperimentConfig = Omit<ExperimentConfig, "indicators"> & {
  indicators: (Omit<Indicator, "min" | "max" | "step"> & {
    min: number | null;
    max: number | null;
    step: number | null;
  })[];
};
export interface Answers {
  numeric: {
    indicator_id: string;
    value: number | null;
    missing_reason: string | null;
  }[];
  text: { text_question_id: string; value: string }[];
}
export interface Profile {
  user_id: string;
  display_name: string;
  participant_code: string;
  role: "admin" | "participant";
  state: "pending_consent" | "active" | "disabled";
  edit_version: number;
  consent_version?: string;
  consented_at?: string;
}
export interface Experiment {
  experiment_id: string;
  status: "draft" | "published" | "closed" | "archived";
  config: ExperimentConfig;
  config_version_id: string | null;
  edit_version: number;
  data_revision: number;
  published_at: string | null;
  closed_at: string | null;
  created_at: string;
  privacy_notice_version?: string;
  privacy_notice?: Record<string, unknown>;
  retention_policy?: Record<string, unknown>;
  collection_ends_at?: string;
}
export interface Assignment {
  assignment_id: string;
  experiment_id: string;
  user_id: string;
  state: "active" | "revoked";
  edit_version: number;
  consented_at: string | null;
  config_version_id: string;
  privacy_notice_version: string;
  created_at: string;
  privacy_notice?: Record<string, unknown>;
  retention_policy?: Record<string, unknown>;
  collection_ends_at?: string;
}
export interface Response {
  is_summary?: boolean;
  latest_revision_no?: number;
  latest_submitted_at?: string | null;
  response_id: string;
  assignment_id: string;
  sample_id: string;
  state: "draft" | "submitted" | "returned";
  draft_answers: Answers;
  edit_version: number;
  latest_revision_id: string | null;
  returned_reason: string | null;
  saved_at: string;
}
export interface SubmissionReceipt {
  response_id: string;
  revision_id: string;
  revision_no: number;
  submitted_at: string;
  edit_version: number;
}
export interface Revision extends SubmissionReceipt {
  answers: Answers;
  config_version_id: string;
  submitted_by?: string;
  idempotency_key?: string;
}
export interface SnapshotRow {
  participant_code: string;
  sample_id: string;
  response_id: string;
  revision_id: string;
  revision_no: number;
  submitted_at: string;
  answers: Answers;
}
export interface Coverage {
  participant_code: string;
  assignment_id: string;
  assignment_state: string;
  sample_id: string;
  response_state: string;
  included: boolean;
  reason: string;
}
export interface Snapshot {
  snapshot_id: string;
  experiment_id: string;
  config_version_id: string;
  config: ExperimentConfig;
  data_revision: number;
  created_at: string;
  input_hash: string;
  rows: SnapshotRow[];
  coverage: Coverage[];
  excluded_revisions?: {
    response_id: string;
    revision_id: string;
    reason: string;
  }[];
  mode: "demo" | "live";
  is_synthetic: boolean;
}
export interface AuditEvent {
  event_id: string;
  actor_id: string;
  action: string;
  object_id: string;
  created_at: string;
  reason?: string;
}
export interface AppState {
  profiles: Profile[];
  experiments: Experiment[];
  assignments: Assignment[];
  responses: Response[];
  revisions: Revision[];
  snapshots: Snapshot[];
  audit_events: AuditEvent[];
}
