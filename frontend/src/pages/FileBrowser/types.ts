//
// types
//

import type { FileEntry } from "../../types";

export type SortField = "name" | "size" | "modified" | "type";

export type ViewMode = "list" | "details";

export interface ViewInfo {
  path: string;
  mimeType: string;
  images?: string[];
  currentIndex?: number;
  sessionId: string;
}

export interface NavigationHistoryEntry {
  focusedIndex: number;
  scrollOffset: number;
  selectedFileName: string | null;
}

export interface DirectoryCacheEntry {
  items: FileEntry[];
  timestamp: number;
}
