import { useEffect, useState } from "react";
import api from "../../services/api";
import { isAdminUser } from "../../utils/userAccess";

interface SettingsAccessState {
  isAdmin: boolean;
}

export function useSettingsAccess(enabled = true): SettingsAccessState {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    if (!enabled) {
      setIsAdmin(false);
      return () => {
        isCancelled = true;
      };
    }

    api
      .getCurrentUser()
      .then((user) => {
        if (!isCancelled) {
          setIsAdmin(isAdminUser(user));
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setIsAdmin(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [enabled]);

  return { isAdmin };
}
