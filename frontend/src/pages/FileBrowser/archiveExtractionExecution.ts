import api from "../../services/api";
import { isLocalDrive } from "../../services/backendRouter";
import {
  beginForegroundLocalArchiveRequest,
  clearForegroundArchiveOperation,
  clearForegroundLocalArchiveRequest,
  storeForegroundArchiveOperation,
} from "../../services/foregroundArchiveOperation";
import type { ArchiveExtractionDecisionAction, ArchiveOperation } from "../../types";
import type {
  ArchiveExtractionConflict,
  ArchiveExtractionConflictAction,
  ArchiveExtractionExecution,
  ArchiveExtractionMemberError,
  ArchiveExtractionOutcome,
  ArchiveExtractionRequest,
  ArchiveExtractionSummary,
} from "./contentProviders";

function nonNegativeCounter(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function archiveExtractionSummary(checkpointJson: string | undefined): ArchiveExtractionSummary {
  try {
    const checkpoint: unknown = JSON.parse(checkpointJson ?? "{}");
    if (typeof checkpoint !== "object" || checkpoint === null) {
      throw new Error("Archive extraction checkpoint is invalid");
    }
    const partialMembers =
      typeof checkpoint.member_outcomes === "object" && checkpoint.member_outcomes !== null && !Array.isArray(checkpoint.member_outcomes)
        ? Object.values(checkpoint.member_outcomes).filter(
            (outcome) => typeof outcome === "object" && outcome !== null && "status" in outcome && outcome.status === "partial"
          ).length
        : 0;
    return {
      filesExtracted: nonNegativeCounter(checkpoint.files_extracted),
      directoriesCreated: nonNegativeCounter(checkpoint.directories_created),
      extractedBytes: nonNegativeCounter(checkpoint.extracted_bytes),
      filesSkipped: nonNegativeCounter(checkpoint.files_skipped),
      filesReplaced: nonNegativeCounter(checkpoint.files_replaced),
      partialMembers,
    };
  } catch {
    return { filesExtracted: 0, directoriesCreated: 0, extractedBytes: 0, filesSkipped: 0, filesReplaced: 0, partialMembers: 0 };
  }
}

function responseExtractionSummary(result: {
  files_extracted?: number;
  directories_created?: number;
  extracted_bytes?: number;
  files_skipped?: number;
  progress?: { partialMembers?: number; totalMembers?: number; totalBytes?: number };
}): ArchiveExtractionSummary {
  return {
    filesExtracted: nonNegativeCounter(result.files_extracted),
    directoriesCreated: nonNegativeCounter(result.directories_created),
    extractedBytes: nonNegativeCounter(result.extracted_bytes),
    totalMembers: nonNegativeCounter(result.progress?.totalMembers) || undefined,
    totalBytes: nonNegativeCounter(result.progress?.totalBytes) || undefined,
    filesSkipped: nonNegativeCounter(result.files_skipped),
    filesReplaced: 0,
    partialMembers: nonNegativeCounter(result.progress?.partialMembers),
  };
}

function companionExtractionOutcome(result: {
  files_extracted: number;
  directories_created: number;
  extracted_bytes: number;
  files_skipped: number;
  phase?: string;
  checkpoint_json?: string;
  pending_decision_json?: string | null;
}): ArchiveExtractionOutcome {
  if (result.phase === "awaiting_user_decision" && typeof result.checkpoint_json === "string") {
    return toExtractionOutcome(result as ArchiveOperation);
  }
  const summary = responseExtractionSummary(result);
  return { status: "completed", filesSkipped: summary.filesSkipped, summary };
}

function pendingConflicts(operation: ArchiveOperation): {
  conflicts: ArchiveExtractionConflict[];
  allowedActions: ArchiveExtractionConflictAction[];
} {
  try {
    const pending: unknown = JSON.parse(operation.pending_decision_json ?? "{}");
    if (
      typeof pending !== "object" ||
      pending === null ||
      !("conflicts" in pending) ||
      !Array.isArray(pending.conflicts) ||
      !("allowed_actions" in pending) ||
      !Array.isArray(pending.allowed_actions)
    ) {
      throw new Error("Archive extraction conflict details are invalid");
    }
    const conflicts = pending.conflicts.map((conflict) => {
      if (
        typeof conflict !== "object" ||
        conflict === null ||
        typeof conflict.member_path !== "string" ||
        typeof conflict.target_path !== "string" ||
        ("is_directory" in conflict && typeof conflict.is_directory !== "boolean") ||
        ("source_size" in conflict && (!Number.isSafeInteger(conflict.source_size) || conflict.source_size < 0)) ||
        ("target_size" in conflict && (!Number.isSafeInteger(conflict.target_size) || conflict.target_size < 0)) ||
        ("source_modified_at" in conflict && typeof conflict.source_modified_at !== "string") ||
        ("target_modified_at" in conflict && typeof conflict.target_modified_at !== "string")
      ) {
        throw new Error("Archive extraction conflict details are invalid");
      }
      return {
        memberPath: conflict.member_path,
        targetPath: conflict.target_path,
        isDirectory: conflict.is_directory,
        sourceSize: conflict.source_size,
        sourceModifiedAt: conflict.source_modified_at,
        targetSize: conflict.target_size,
        targetModifiedAt: conflict.target_modified_at,
      };
    });
    const allowedActions = pending.allowed_actions.filter(
      (action): action is ArchiveExtractionConflictAction =>
        action === "skip" ||
        action === "skip_all" ||
        action === "replace" ||
        action === "replace_all" ||
        action === "replace_older" ||
        action === "rename"
    );
    if (allowedActions.length !== pending.allowed_actions.length) {
      throw new Error("Archive extraction conflict details are invalid");
    }
    return { conflicts, allowedActions };
  } catch (error) {
    throw error instanceof Error ? error : new Error("Archive extraction conflict details are invalid");
  }
}

function pendingMemberError(operation: ArchiveOperation): ArchiveExtractionMemberError {
  try {
    const pending: unknown = JSON.parse(operation.pending_decision_json ?? "{}");
    if (
      typeof pending !== "object" ||
      pending === null ||
      pending.kind !== "member_error" ||
      typeof pending.member_path !== "string" ||
      typeof pending.target_path !== "string" ||
      typeof pending.message !== "string" ||
      typeof pending.partial_output !== "boolean" ||
      !Array.isArray(pending.allowed_actions) ||
      !pending.allowed_actions.includes("retry") ||
      !pending.allowed_actions.includes("ignore")
    ) {
      throw new Error("Archive extraction member error details are invalid");
    }
    return {
      memberPath: pending.member_path,
      targetPath: pending.target_path,
      message: pending.message,
      partialOutput: pending.partial_output,
    };
  } catch (error) {
    throw error instanceof Error ? error : new Error("Archive extraction member error details are invalid");
  }
}

function toExtractionOutcome(operation: ArchiveOperation): ArchiveExtractionOutcome {
  if (operation.phase === "completed") {
    const summary = archiveExtractionSummary(operation.checkpoint_json);
    return { status: "completed", filesSkipped: summary.filesSkipped, summary };
  }
  if (operation.phase === "cancelled") {
    return { status: "cancelled" };
  }
  if (operation.phase === "awaiting_user_decision") {
    const pending: unknown = JSON.parse(operation.pending_decision_json ?? "{}");
    if (typeof pending === "object" && pending !== null && pending.kind === "member_error") {
      return { status: "awaiting-member-error", error: pendingMemberError(operation) };
    }
    return { status: "awaiting-decision", ...pendingConflicts(operation) };
  }
  throw new Error("Archive extraction did not reach a terminal state");
}

export function startZipArchiveExtraction(request: ArchiveExtractionRequest): ArchiveExtractionExecution {
  const { source: location, destination } = request;
  const destinationPath = destination.path;
  if (location.providerId !== "zip") {
    return {
      result: Promise.reject(new Error("Archive extraction is unavailable for this content provider")),
      cancel: async () => undefined,
      decide: async () => {
        throw new Error("Archive extraction is unavailable for this content provider");
      },
      onProgress: () => () => undefined,
      isCancellationRequested: () => false,
    };
  }

  let operationId: string | null = null;
  let localSignal: AbortSignal | null = null;
  let localExecution: { executionId: string; revision: number } | null = null;
  let localCancellation: Promise<void> | null = null;
  let awaitingDecision = false;
  let cancellationRequested = false;
  let latestProgress: ArchiveExtractionSummary | null = null;
  const progressListeners = new Set<(summary: ArchiveExtractionSummary) => void>();

  const publishLocalProgress = (execution: Parameters<typeof responseExtractionSummary>[0]) => {
    latestProgress = responseExtractionSummary(execution);
    for (const listener of progressListeners) {
      listener(latestProgress);
    }
  };

  const cancelLocalExecution = async (): Promise<void> => {
    if (!localExecution) {
      return;
    }
    if (!localCancellation) {
      const execution = localExecution;
      localCancellation = (async () => {
        const cancelled = await api.cancelLocalArchiveExecutionWithRevisionRetry(
          location.connectionId,
          execution.executionId,
          execution.revision
        );
        execution.revision = cancelled.revision;
      })();
    }
    await localCancellation;
  };

  const finishServerOutcome = (outcome: ArchiveExtractionOutcome): ArchiveExtractionOutcome => {
    awaitingDecision = outcome.status === "awaiting-decision" || outcome.status === "awaiting-member-error";
    if (!awaitingDecision && operationId) {
      clearForegroundArchiveOperation(operationId);
    }
    return outcome;
  };

  const waitForLocalOutcome = async (): Promise<ArchiveExtractionOutcome> => {
    if (!localExecution) {
      throw new Error("Local archive extraction is unavailable");
    }
    const status = await api.waitForLocalArchiveExecution(location.connectionId, localExecution.executionId, publishLocalProgress);
    localExecution.revision = status.revision;
    if (status.phase === "completed") {
      const summary = latestProgress ?? responseExtractionSummary(status);
      return { status: "completed", filesSkipped: summary.filesSkipped, summary };
    }
    if (status.phase === "cancelled") {
      return { status: "interrupted" };
    }
    if (status.phase === "awaiting_user_decision") {
      const pendingDecision = status.pendingDecision;
      awaitingDecision = true;
      if (!pendingDecision) {
        throw new Error("Local archive extraction is missing its pending decision");
      }
      if (pendingDecision.kind === "member_error") {
        return {
          status: "awaiting-member-error",
          error: {
            memberPath: pendingDecision.member_path,
            targetPath: pendingDecision.target_path,
            message: pendingDecision.message,
            partialOutput: pendingDecision.partial_output,
          },
        };
      }
      return {
        status: "awaiting-decision",
        conflicts: pendingDecision.conflicts.map((conflict) => ({
          memberPath: conflict.member_path,
          targetPath: [destinationPath, conflict.target_path].filter(Boolean).join("/"),
          isDirectory: conflict.is_directory,
        })),
        allowedActions: pendingDecision.allowed_actions,
      };
    }
    throw new Error(status.error ?? "Local archive extraction failed");
  };

  const executeServerOperation = async (): Promise<ArchiveExtractionOutcome> => {
    if (!operationId) {
      throw new Error("Archive extraction operation is unavailable");
    }
    return finishServerOutcome(toExtractionOutcome(await api.executeArchiveExtraction(operationId)));
  };

  const executeCompanionOperation = async (): Promise<ArchiveExtractionOutcome> => {
    if (!operationId) throw new Error("Archive extraction operation is unavailable");
    const companionSession = await api.getArchiveCompanionSession(operationId);
    const companionResult = isLocalDrive(location.connectionId)
      ? await api.extractLocalArchiveToSmb(location.connectionId, location.source.path, operationId, companionSession.token)
      : await api.extractSmbArchiveToLocal(destination.connectionId, destinationPath, operationId, companionSession.token);
    return finishServerOutcome(companionExtractionOutcome(companionResult));
  };

  const result = (async (): Promise<ArchiveExtractionOutcome> => {
    const sourceIsLocal = isLocalDrive(location.connectionId);
    const destinationIsLocal = isLocalDrive(destination.connectionId);
    if (sourceIsLocal && destinationIsLocal) {
      if (location.connectionId !== destination.connectionId) {
        throw new Error("Archive extraction between local drives is not available");
      }
      localSignal = beginForegroundLocalArchiveRequest();
      const onLocalAbort = () => {
        cancellationRequested = true;
        void cancelLocalExecution();
      };
      localSignal.addEventListener("abort", onLocalAbort, { once: true });
      try {
        const execution = await api.startLocalArchiveExtraction(location.connectionId, location.source.path, destinationPath);
        localExecution = { executionId: execution.execution_id, revision: execution.revision };
        if (cancellationRequested) {
          await cancelLocalExecution();
        }
        return await waitForLocalOutcome();
      } finally {
        localSignal.removeEventListener("abort", onLocalAbort);
        clearForegroundLocalArchiveRequest(localSignal);
      }
    }
    if (!sourceIsLocal && !destinationIsLocal && location.connectionId !== destination.connectionId) {
      throw new Error("Archive extraction between SMB connections is not available");
    }

    try {
      const operation = await api.prepareArchiveOperation({
        contract_version: "v2",
        kind: "extract",
        source_connection_id: location.connectionId,
        source_path: location.source.path,
        destination_connection_id: destination.connectionId,
        destination_path: destinationPath,
      });
      operationId = operation.id;
      storeForegroundArchiveOperation(operationId);
      if (cancellationRequested) {
        await api.cancelArchiveOperation(operationId);
        clearForegroundArchiveOperation(operationId);
        return { status: "cancelled" };
      }
      if (!sourceIsLocal && !destinationIsLocal) {
        return await executeServerOperation();
      }

      return await executeCompanionOperation();
    } catch (error) {
      if (operationId && !cancellationRequested) {
        try {
          await api.cancelArchiveOperation(operationId);
          clearForegroundArchiveOperation(operationId);
        } catch {
          // Retain the marker so the page-reload recovery path can retry cancellation.
        }
      }
      throw error;
    }
  })();

  return {
    result,
    async cancel() {
      cancellationRequested = true;
      if (localExecution) {
        await cancelLocalExecution();
        return;
      }
      if (localSignal) {
        await cancelLocalExecution();
        return;
      }
      if (!operationId) {
        return;
      }
      if (awaitingDecision) {
        await api.decideArchiveExtraction(operationId, "cancel");
        clearForegroundArchiveOperation(operationId);
        return;
      }
      await api.cancelArchiveOperation(operationId);
    },
    onProgress(listener) {
      progressListeners.add(listener);
      if (latestProgress) {
        listener(latestProgress);
      }
      return () => progressListeners.delete(listener);
    },
    async decide(action: ArchiveExtractionDecisionAction, memberPath?: string, targetPath?: string) {
      if (localExecution && awaitingDecision) {
        if (
          !memberPath ||
          (action !== "skip" &&
            action !== "skip_all" &&
            action !== "replace" &&
            action !== "replace_all" &&
            action !== "replace_older" &&
            action !== "rename" &&
            action !== "retry" &&
            action !== "ignore")
        ) {
          throw new Error("Local archive extraction requires a valid decision for the pending member");
        }
        const execution =
          targetPath === undefined
            ? await api.decideLocalArchiveExecution(
                location.connectionId,
                localExecution.executionId,
                localExecution.revision,
                memberPath,
                action
              )
            : await api.decideLocalArchiveExecution(
                location.connectionId,
                localExecution.executionId,
                localExecution.revision,
                memberPath,
                action,
                targetPath
              );
        localExecution.revision = execution.revision;
        if (execution.phase === "cancelled") {
          return { status: "cancelled" };
        }
        if (execution.phase !== "streaming") {
          throw new Error("Local archive extraction did not resume after the collision decision");
        }
        awaitingDecision = false;
        return await waitForLocalOutcome();
      }
      if (!operationId || !awaitingDecision) {
        throw new Error("Archive extraction is not awaiting a collision decision");
      }
      const operation = await api.decideArchiveExtraction(operationId, action, memberPath, targetPath);
      if (operation.phase === "cancelled") {
        return finishServerOutcome({ status: "cancelled" });
      }
      if (operation.phase !== "streaming") {
        throw new Error("Archive extraction did not resume after the collision decision");
      }
      awaitingDecision = false;
      return isLocalDrive(location.connectionId) || isLocalDrive(destination.connectionId)
        ? executeCompanionOperation()
        : executeServerOperation();
    },
    isCancellationRequested: () => cancellationRequested,
  };
}
