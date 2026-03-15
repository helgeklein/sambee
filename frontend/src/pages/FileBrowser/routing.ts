import { extractDriveId, isLocalDrive, LOCAL_DRIVE_PREFIX } from "../../services/backendRouter";
import type { Connection } from "../../types";
import type { PaneId } from "./types";

export const BROWSE_TARGET_KIND_SMB = "smb";
export const BROWSE_TARGET_KIND_LOCAL = "local";

export type BrowseTargetKind = typeof BROWSE_TARGET_KIND_SMB | typeof BROWSE_TARGET_KIND_LOCAL;

export interface BrowseRouteTarget {
  kind: BrowseTargetKind;
  targetId: string;
  path: string;
}

export interface ResolvedBrowseRouteTarget extends BrowseRouteTarget {
  connectionId: string;
}

export interface BrowseRouteState {
  left: BrowseRouteTarget | null;
  right: BrowseRouteTarget | null;
  activePaneId: PaneId;
}

export interface ResolvedBrowseRouteState {
  left: ResolvedBrowseRouteTarget | null;
  right: ResolvedBrowseRouteTarget | null;
  activePaneId: PaneId;
}

interface ParseBrowseRouteInput {
  targetType?: string;
  targetId?: string;
  path?: string;
  searchParams: URLSearchParams;
}

const RIGHT_PANE_QUERY_KEY = "p2";
const ACTIVE_PANE_QUERY_KEY = "active";

const isBrowseTargetKind = (value?: string): value is BrowseTargetKind => {
  return value === BROWSE_TARGET_KIND_SMB || value === BROWSE_TARGET_KIND_LOCAL;
};

const encodePath = (path: string): string => {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
};

const decodePath = (path: string): string => {
  return path
    .split("/")
    .map((segment) => decodeURIComponent(segment))
    .join("/");
};

const parseRouteTarget = (kind: string | undefined, targetId: string | undefined, path: string | undefined): BrowseRouteTarget | null => {
  if (!isBrowseTargetKind(kind) || !targetId) {
    return null;
  }

  const decodedTargetId = decodeURIComponent(targetId);
  return {
    kind,
    targetId: decodedTargetId,
    path: decodePath(path ?? ""),
  };
};

export const buildBrowseRouteTarget = (
  connectionId: string,
  path: string,
  connections: Pick<Connection, "id" | "slug">[]
): BrowseRouteTarget | null => {
  if (!connectionId) {
    return null;
  }

  if (isLocalDrive(connectionId)) {
    const driveId = extractDriveId(connectionId);
    return {
      kind: BROWSE_TARGET_KIND_LOCAL,
      targetId: driveId,
      connectionId,
      path,
    };
  }

  const connection = connections.find((candidate) => candidate.id === connectionId);
  if (!connection?.slug) {
    return null;
  }

  return {
    kind: BROWSE_TARGET_KIND_SMB,
    targetId: connection.slug,
    path,
  };
};

export const resolveBrowseRouteTarget = (
  target: BrowseRouteTarget | null,
  connections: Pick<Connection, "id" | "slug">[]
): ResolvedBrowseRouteTarget | null => {
  if (!target) {
    return null;
  }

  if (target.kind === BROWSE_TARGET_KIND_LOCAL) {
    return {
      ...target,
      connectionId: `${LOCAL_DRIVE_PREFIX}${target.targetId}`,
    };
  }

  const connection = connections.find((candidate) => candidate.slug === target.targetId);
  if (!connection) {
    return null;
  }

  return {
    ...target,
    connectionId: connection.id,
  };
};

export const resolveBrowseRouteState = (
  state: BrowseRouteState,
  connections: Pick<Connection, "id" | "slug">[]
): ResolvedBrowseRouteState => {
  return {
    left: resolveBrowseRouteTarget(state.left, connections),
    right: resolveBrowseRouteTarget(state.right, connections),
    activePaneId: state.activePaneId,
  };
};

export const parseBrowseRoute = ({ targetType, targetId, path, searchParams }: ParseBrowseRouteInput): BrowseRouteState => {
  const left = parseRouteTarget(targetType, targetId, path);

  const p2 = searchParams.get(RIGHT_PANE_QUERY_KEY);
  let right: BrowseRouteTarget | null = null;
  if (p2) {
    const [rawKind, rawTargetId, ...encodedPathSegments] = p2.split("/");
    right = parseRouteTarget(rawKind, rawTargetId, encodedPathSegments.join("/"));
  }

  const activePaneId: PaneId = right && searchParams.get(ACTIVE_PANE_QUERY_KEY) === "2" ? "right" : "left";

  return {
    left,
    right,
    activePaneId,
  };
};

export const serializeBrowseRoute = ({ left, right, activePaneId }: BrowseRouteState): string => {
  if (!left) {
    return "/browse";
  }

  const encodedTargetId = encodeURIComponent(left.targetId);
  const encodedLeftPath = encodePath(left.path);
  let nextUrl = `/browse/${left.kind}/${encodedTargetId}${encodedLeftPath ? `/${encodedLeftPath}` : ""}`;

  if (right) {
    const encodedRightTargetId = encodeURIComponent(right.targetId);
    const encodedRightPath = encodePath(right.path);
    const p2Value = `${right.kind}/${encodedRightTargetId}${encodedRightPath ? `/${encodedRightPath}` : ""}`;
    const queryParams = new URLSearchParams();
    queryParams.set(RIGHT_PANE_QUERY_KEY, p2Value);
    if (activePaneId === "right") {
      queryParams.set(ACTIVE_PANE_QUERY_KEY, "2");
    }
    nextUrl += `?${queryParams.toString()}`;
  }

  return nextUrl;
};
