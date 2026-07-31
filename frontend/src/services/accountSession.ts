import { authSession } from "./authSession";
import { clearBrowserRecoverySnapshot } from "./browserRecoverySnapshot";
import { clearCurrentUserDrafts } from "./draftRecovery";
import { OIDC_LOGOUT_MARKER } from "./oidcAuth";

export async function signOutCurrentBrowser(): Promise<void> {
  clearBrowserRecoverySnapshot();
  clearCurrentUserDrafts();
  await authSession.logout();
  sessionStorage.setItem(OIDC_LOGOUT_MARKER, "1");
}
