import { useEffect, useState } from "react";
import { authSession } from "../services/authSession";
import { purgeExpiredDraftsForCurrentUser } from "../services/draftRecovery";

const DRAFT_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

export function useDraftRecoveryCleanup(): void {
  const [userId, setUserId] = useState(() => authSession.getUserId());

  useEffect(() => authSession.subscribeToIdentity((identity) => setUserId(identity.userId)), []);

  useEffect(() => {
    if (!userId) {
      return;
    }

    const purgeExpiredDrafts = () => purgeExpiredDraftsForCurrentUser();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        purgeExpiredDrafts();
      }
    };

    purgeExpiredDrafts();
    window.addEventListener("focus", purgeExpiredDrafts);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    const intervalId = window.setInterval(purgeExpiredDrafts, DRAFT_CLEANUP_INTERVAL_MS);
    return () => {
      window.removeEventListener("focus", purgeExpiredDrafts);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.clearInterval(intervalId);
    };
  }, [userId]);
}
