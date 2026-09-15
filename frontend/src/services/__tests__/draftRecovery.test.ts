import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getUserId } = vi.hoisted(() => ({ getUserId: vi.fn() }));

vi.mock("../authSession", () => ({ authSession: { getUserId } }));

import {
  clearDraft,
  DRAFT_RECOVERY_CHANGED_EVENT,
  getUnsavedDraftsForConnection,
  loadDraft,
  purgeExpiredDraftsForCurrentUser,
  saveDraft,
} from "../draftRecovery";

const USER_ID = "test-user";
const CONNECTION_ID = "connection";

describe("draft recovery", () => {
  beforeEach(() => {
    sessionStorage.clear();
    getUserId.mockReturnValue(USER_ID);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-09T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("enumerates only changed, valid drafts for a connection", () => {
    saveDraft(CONNECTION_ID, "notes/a.md", "markdown", "saved", "local draft");
    saveDraft(CONNECTION_ID, "notes/b.txt", "text", "same", "same");
    saveDraft("other", "notes/c.txt", "text", "saved", "local draft");

    expect(getUnsavedDraftsForConnection(CONNECTION_ID)).toEqual([
      expect.objectContaining({ connectionId: CONNECTION_ID, editorType: "markdown", path: "/notes/a.md" }),
    ]);
  });

  it("notifies browser panes when a draft is saved or cleared", () => {
    const changed = vi.fn();
    window.addEventListener(DRAFT_RECOVERY_CHANGED_EVENT, changed);

    saveDraft(CONNECTION_ID, "notes/a.md", "markdown", "saved", "local draft");
    clearDraft(CONNECTION_ID, "notes/a.md", "markdown");

    expect(changed).toHaveBeenCalledTimes(2);
    window.removeEventListener(DRAFT_RECOVERY_CHANGED_EVENT, changed);
  });

  it("purges malformed and expired current-user drafts", () => {
    const changed = vi.fn();
    window.addEventListener(DRAFT_RECOVERY_CHANGED_EVENT, changed);
    const oldTime = Date.now() - 24 * 60 * 60 * 1000 - 1;
    sessionStorage.setItem(
      `sambee_oidc_draft:${USER_ID}:${CONNECTION_ID}:text:${encodeURIComponent("/expired.txt")}`,
      JSON.stringify({ baseline: "saved", content: "draft", updatedAt: oldTime })
    );
    sessionStorage.setItem(`sambee_oidc_draft:${USER_ID}:${CONNECTION_ID}:text:bad`, "not-json");

    purgeExpiredDraftsForCurrentUser();

    expect(getUnsavedDraftsForConnection(CONNECTION_ID)).toEqual([]);
    expect(changed).toHaveBeenCalledTimes(1);
    window.removeEventListener(DRAFT_RECOVERY_CHANGED_EVENT, changed);
  });

  it("removes a malformed requested draft safely", () => {
    sessionStorage.setItem(`sambee_oidc_draft:${USER_ID}:${CONNECTION_ID}:text:${encodeURIComponent("/bad.txt")}`, "not-json");

    expect(loadDraft(CONNECTION_ID, "bad.txt", "text")).toBeNull();
  });
});
