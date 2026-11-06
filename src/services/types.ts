import type { AppState, Issue } from "../domain/types";
export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "CONSENT_REQUIRED"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "EXPERIMENT_NOT_OPEN"
  | "ASSIGNMENT_REVOKED"
  | "RESPONSE_LOCKED"
  | "VERSION_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "DATA_CHANGED"
  | "RATE_LIMITED"
  | "STORAGE_UNAVAILABLE"
  | "SERVICE_UNAVAILABLE"
  | "INFERENCE_UNAVAILABLE";
export type Result<T> =
  | { ok: true; data: T; request_id: string }
  | {
      ok: false;
      error: {
        code: ErrorCode;
        message: string;
        field_errors?: Issue[];
        latest_version?: number;
        retryable: boolean;
      };
      request_id: string;
    };
export interface ServiceAdapter {
  initialize(): Promise<void>;
  read(): Promise<AppState>;
  execute(action: string, input: any): Promise<Result<any>>;
}
