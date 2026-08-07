import { authSession } from "./authSession";
import { clearBrowserRecoverySnapshot } from "./browserRecoverySnapshot";
import { clearCurrentUserDrafts } from "./draftRecovery";
import { OIDC_LOGOUT_MARKER } from "./oidcAuth";

export function clearCurrentBrowserSession(): void {
  clearBrowserRecoverySnapshot();
  clearCurrentUserDrafts();
  authSession.clear();
  sessionStorage.setItem(OIDC_LOGOUT_MARKER, "1");
}

export async function signOutCurrentBrowser(): Promise<void> {
  clearCurrentBrowserSession();
  await authSession.logout();
}
