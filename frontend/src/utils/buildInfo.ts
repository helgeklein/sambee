import type { VersionInfo } from "./version";

export interface BuildInfo {
  version: string;
  git_commit: string;
}

const SHORT_COMMIT_LENGTH = 7;
const UNKNOWN_BUILD_VALUE = "unknown";

function readBuildValue(value: string | undefined): string {
  return typeof value === "string" && value.trim() ? value : UNKNOWN_BUILD_VALUE;
}

export const CURRENT_BUILD_INFO: BuildInfo = Object.freeze({
  version: readBuildValue(typeof __SAMBEE_VERSION__ !== "undefined" ? __SAMBEE_VERSION__ : undefined),
  git_commit: readBuildValue(typeof __SAMBEE_GIT_COMMIT__ !== "undefined" ? __SAMBEE_GIT_COMMIT__ : undefined),
});

export function getBuildFingerprint(buildInfo: Pick<BuildInfo, "version" | "git_commit">): string {
  return `${buildInfo.version}:${buildInfo.git_commit}`;
}

function normalizeBuildValue(value: string): string {
  return value.trim().toLowerCase();
}

function isKnownBuildValue(value: string): boolean {
  return Boolean(value.trim()) && normalizeBuildValue(value) !== UNKNOWN_BUILD_VALUE;
}

export function hasKnownCurrentBuildInfo(): boolean {
  return isKnownBuildValue(CURRENT_BUILD_INFO.version);
}

export function hasBuildMismatchFor(
  currentBuildInfo: Pick<BuildInfo, "version" | "git_commit">,
  versionInfo: Pick<VersionInfo, "version" | "git_commit">
): boolean {
  if (!isKnownBuildValue(currentBuildInfo.version) || !isKnownBuildValue(versionInfo.version)) {
    return false;
  }

  if (versionInfo.version !== currentBuildInfo.version) {
    return true;
  }

  const currentCommitKnown = isKnownBuildValue(currentBuildInfo.git_commit);
  const serverCommitKnown = isKnownBuildValue(versionInfo.git_commit);

  if (!currentCommitKnown || !serverCommitKnown) {
    return false;
  }

  return normalizeBuildValue(versionInfo.git_commit) !== normalizeBuildValue(currentBuildInfo.git_commit);
}

export function hasBuildMismatch(versionInfo: Pick<VersionInfo, "version" | "git_commit">): boolean {
  return hasBuildMismatchFor(CURRENT_BUILD_INFO, versionInfo);
}

export function shortenCommit(commit: string): string {
  if (!commit || commit === UNKNOWN_BUILD_VALUE) {
    return UNKNOWN_BUILD_VALUE;
  }

  return commit.slice(0, SHORT_COMMIT_LENGTH);
}
