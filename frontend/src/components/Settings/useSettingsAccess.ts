import { useEffect, useState } from "react";
import api from "../../services/api";
import { canUserWrite, isAdminUser } from "../../utils/userAccess";

interface SettingsAccessState {
  isAdmin: boolean;
  canWrite: boolean;
}

export function useSettingsAccess(enabled = true): SettingsAccessState {
  const [isAdmin, setIsAdmin] = useState(false);
  const [canWrite, setCanWrite] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    if (!enabled) {
      setIsAdmin(false);
      setCanWrite(false);
      return () => {
        isCancelled = true;
      };
    }

    api
      .getCurrentUser()
      .then((user) => {
        if (!isCancelled) {
          setIsAdmin(isAdminUser(user));
          setCanWrite(canUserWrite(user));
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setIsAdmin(false);
          setCanWrite(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [enabled]);

  return { isAdmin, canWrite };
}
