import { beforeEach, describe, expect, it } from "vitest";
import { CODEMIRROR_FIND_HISTORY_STORAGE_KEY, CODEMIRROR_FIND_REPLACE_HISTORY_LIMIT } from "../codeMirrorFindReplaceConstants";
import {
  addCodeMirrorFindReplaceHistoryEntry,
  readCodeMirrorFindReplaceHistory,
  writeCodeMirrorFindReplaceHistory,
} from "../codeMirrorFindReplaceHistory";

describe("codeMirrorFindReplaceHistory", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("deduplicates recent values and retains only the ten newest entries", () => {
    let history: string[] = [];

    for (let index = 0; index < CODEMIRROR_FIND_REPLACE_HISTORY_LIMIT + 1; index += 1) {
      history = addCodeMirrorFindReplaceHistoryEntry(history, `value ${index}`);
    }

    history = addCodeMirrorFindReplaceHistoryEntry(history, "value 5");

    expect(history).toHaveLength(CODEMIRROR_FIND_REPLACE_HISTORY_LIMIT);
    expect(history[0]).toBe("value 5");
    expect(history).not.toContain("value 0");
  });

  it("ignores malformed persisted history and writes valid entries", () => {
    localStorage.setItem(CODEMIRROR_FIND_HISTORY_STORAGE_KEY, "not json");
    expect(readCodeMirrorFindReplaceHistory(CODEMIRROR_FIND_HISTORY_STORAGE_KEY)).toEqual([]);

    writeCodeMirrorFindReplaceHistory(CODEMIRROR_FIND_HISTORY_STORAGE_KEY, ["first value"]);
    expect(readCodeMirrorFindReplaceHistory(CODEMIRROR_FIND_HISTORY_STORAGE_KEY)).toEqual(["first value"]);
  });
});
