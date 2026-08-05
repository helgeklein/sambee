/** Format a directory for display as "connection:/path". */
export function formatConnectionPath(connectionName: string, path: string): string {
  const displayPath = path === "" ? "/" : `/${path}`;
  return connectionName ? `${connectionName}:${displayPath}` : displayPath;
}
