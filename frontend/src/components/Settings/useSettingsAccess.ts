import { createContext, createElement, type ReactNode, useContext, useEffect, useState } from "react";
import api from "../../services/api";
import { canUserWrite, isAdminUser } from "../../utils/userAccess";

interface SettingsAccessState {
  isAdmin: boolean;
  canWrite: boolean;
}

const SettingsAccessContext = createContext<SettingsAccessState | null>(null);

export function SettingsAccessProvider({ value, children }: { value: SettingsAccessState; children: ReactNode }) {
  return createElement(SettingsAccessContext.Provider, { value }, children);
}

export function useSettingsAccess(enabled = true): SettingsAccessState {
  const contextualAccess = useContext(SettingsAccessContext);
  const [isAdmin, setIsAdmin] = useState(false);
  const [canWrite, setCanWrite] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    if (!enabled || contextualAccess) {
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
  }, [contextualAccess, enabled]);

  return contextualAccess ?? { isAdmin, canWrite };
}
