export type AuthRetryReason = "upload" | "conflict";

export type AuthRetryResult = {
  status: "auth_retry";
  reason: AuthRetryReason;
};

export type CompletedResult = {
  status: "completed";
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
