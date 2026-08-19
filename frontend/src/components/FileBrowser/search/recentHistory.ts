export async function removeRecentHistoryResult<T>({
  value,
  prefix,
  records,
  remove,
  publish,
}: {
  value: string;
  prefix: string;
  records: Map<string, T>;
  remove: (recordId: string) => Promise<void>;
  publish: () => void;
}): Promise<boolean> {
  if (!value.startsWith(prefix)) {
    return false;
  }

  const recordId = value.slice(prefix.length);
  if (!records.has(recordId)) {
    return false;
  }

  await remove(recordId);
  records.delete(recordId);
  publish();
  return true;
}
