export type AuthRetryReason = "upload" | "conflict";
export type LifecycleErrorStatus = "renewal_required" | "auth_failed" | "lock_lost" | "recovery_required";

export type AuthRetryResult = {
  status: "auth_retry";
  reason: AuthRetryReason;
};

export type CompletedResult = {
  status: "completed";
};

export type LifecycleErrorResult = {
  status: LifecycleErrorStatus;
  message: string;
};

export function getTauriErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function isAuthRetryResult(result: unknown, reason?: AuthRetryReason): result is AuthRetryResult {
  if (!result || typeof result !== "object") {
    return false;
  }

  const candidate = result as Partial<AuthRetryResult>;
  if (candidate.status !== "auth_retry") {
    return false;
  }

  return reason ? candidate.reason === reason : candidate.reason === "upload" || candidate.reason === "conflict";
}

export function isLifecycleErrorResult(result: unknown, status?: LifecycleErrorStatus): result is LifecycleErrorResult {
  if (!result || typeof result !== "object") {
    return false;
  }

  const candidate = result as Partial<LifecycleErrorResult>;
  if (
    candidate.status !== "renewal_required" &&
    candidate.status !== "auth_failed" &&
    candidate.status !== "lock_lost" &&
    candidate.status !== "recovery_required"
  ) {
    return false;
  }

  if (typeof candidate.message !== "string") {
    return false;
  }

  return status ? candidate.status === status : true;
}
