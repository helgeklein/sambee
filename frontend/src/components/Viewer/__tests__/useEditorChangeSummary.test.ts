import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorChangeSummary } from "../useEditorChangeSummary";

describe("useEditorChangeSummary", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces normal edits but immediately calculates a recovered draft", () => {
    const { result, rerender } = renderHook(
      ({ current, immediateUpdateToken }) => useEditorChangeSummary({ baseline: "saved", current, enabled: true, immediateUpdateToken }),
      { initialProps: { current: "saved", immediateUpdateToken: 0 } }
    );

    expect(result.current).toBeNull();

    rerender({ current: "edited", immediateUpdateToken: 0 });
    act(() => vi.advanceTimersByTime(249));
    expect(result.current).toBeNull();

    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toMatchObject({ added: 0, deleted: 0, modified: 1 });

    rerender({ current: "recovered", immediateUpdateToken: 1 });
    expect(result.current).toMatchObject({ added: 0, deleted: 0, modified: 1 });
  });
});
