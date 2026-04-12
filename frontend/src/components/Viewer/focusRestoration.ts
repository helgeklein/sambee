export interface RetriableFocusRestoreOptions {
  delaysMs: readonly number[];
  attemptRestore: () => boolean;
}

export type FocusRestoreCleanup = () => void;

export function scheduleRetriableFocusRestore({ delaysMs, attemptRestore }: RetriableFocusRestoreOptions): FocusRestoreCleanup {
  let settled = false;
  let timeoutIds: number[] = [];

  const settle = () => {
    if (settled) {
      return;
    }

    settled = true;

    for (const timeoutId of timeoutIds) {
      window.clearTimeout(timeoutId);
    }
  };

  timeoutIds = delaysMs.map((delayMs) =>
    window.setTimeout(() => {
      if (settled) {
        return;
      }

      if (attemptRestore()) {
        settle();
      }
    }, delayMs)
  );

  return settle;
}
