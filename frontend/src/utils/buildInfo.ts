import type { VersionInfo } from "./version";

export interface BuildInfo {
  version: string;
  git_commit: string;
}

type SambeeBuildGlobals = typeof globalThis & {
  __SAMBEE_VERSION__?: string;
  __SAMBEE_GIT_COMMIT__?: string;
};

const SHORT_COMMIT_LENGTH = 7;
const UNKNOWN_BUILD_VALUE = "unknown";

const buildGlobals = globalThis as SambeeBuildGlobals;

function readBuildGlobal(key: keyof Pick<SambeeBuildGlobals, "__SAMBEE_VERSION__" | "__SAMBEE_GIT_COMMIT__">): string {
  const value = buildGlobals[key];
  return typeof value === "string" && value.trim() ? value : UNKNOWN_BUILD_VALUE;
}

export const CURRENT_BUILD_INFO: BuildInfo = Object.freeze({
  version: readBuildGlobal("__SAMBEE_VERSION__"),
  git_commit: readBuildGlobal("__SAMBEE_GIT_COMMIT__"),
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
