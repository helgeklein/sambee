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

export function hasBuildMismatch(versionInfo: Pick<VersionInfo, "version" | "git_commit">): boolean {
  if (versionInfo.version !== CURRENT_BUILD_INFO.version) {
    return true;
  }

  const currentCommitKnown = isKnownBuildValue(CURRENT_BUILD_INFO.git_commit);
  const serverCommitKnown = isKnownBuildValue(versionInfo.git_commit);

  if (!currentCommitKnown || !serverCommitKnown) {
    return false;
  }

  return normalizeBuildValue(versionInfo.git_commit) !== normalizeBuildValue(CURRENT_BUILD_INFO.git_commit);
}

export function shortenCommit(commit: string): string {
  if (!commit || commit === UNKNOWN_BUILD_VALUE) {
    return UNKNOWN_BUILD_VALUE;
  }

  return commit.slice(0, SHORT_COMMIT_LENGTH);
}
