/**
 * Auto-discovered mock for @tanstack/react-virtual
 * Vitest automatically uses this when vi.mock('@tanstack/react-virtual') is called
 */

import { vi } from "vitest";

/**
 * Mock for useVirtualizer hook - simulates virtualization without actual DOM measurements
 * This renders all items for testing purposes while maintaining the API shape
 *
 * In production, TanStack Virtual only renders visible items plus overscan.
 * For tests, we render all items to simplify assertions.
 */
export const useVirtualizer = ({
  count,
  estimateSize,
  getScrollElement,
  overscan = 5,
}: {
  count: number;
  estimateSize: () => number;
  getScrollElement: () => HTMLElement | null;
  overscan?: number;
  scrollMargin?: number;
  measureElement?: (element: Element) => number;
}) => {
  const itemSize = estimateSize();

  const scrollToIndexMock = vi.fn((index: number) => {
    // Simulate scrolling by setting scrollTop
    const scrollElement = getScrollElement();
    if (scrollElement) {
      scrollElement.scrollTop = index * itemSize;
    }
  });

  return {
    // Render ALL items for testing (production only renders visible + overscan)
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        key: i,
        start: i * itemSize,
        size: itemSize,
        end: (i + 1) * itemSize,
        lane: 0,
      })),
    getTotalSize: () => count * itemSize,
    scrollToIndex: scrollToIndexMock,
    measureElement: vi.fn(),
    scrollToOffset: vi.fn((offset: number) => {
      const scrollElement = getScrollElement();
      if (scrollElement) {
        scrollElement.scrollTop = offset;
      }
    }),
    measure: vi.fn(),
    options: {
      count,
      estimateSize,
      overscan,
    },
  };
};
