import { isLocalDrive } from "./backendRouter";
import { type CompanionPairingErrorKind, hasStoredSecret, isCompanionAuthSignatureMismatch, isCompanionPairingMissing } from "./companion";

export type { CompanionPairingErrorKind };

export function getLocalDrivePairingErrorKind(connectionId: string, error: unknown): CompanionPairingErrorKind | null {
  if (!isLocalDrive(connectionId)) return null;
  if (isCompanionAuthSignatureMismatch(error)) return "signature";
  if (!hasStoredSecret() || isCompanionPairingMissing(error)) return "pairing_required";
  return null;
}
