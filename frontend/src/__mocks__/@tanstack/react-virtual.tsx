/**
 * Auto-discovered mock for @tanstack/react-virtual
 * Vitest automatically uses this when vi.mock('@tanstack/react-virtual') is called
 */

import { vi } from "vitest";

/**
 * Mock for useVirtualizer hook - simulates virtualization without actual DOM measurements
 * This renders all items for testing purposes while maintaining the API shape
 */
export const useVirtualizer = ({ count, estimateSize }: {
  count: number;
  estimateSize: () => number;
  getScrollElement: () => HTMLElement | null;
  overscan?: number;
  scrollMargin?: number;
  measureElement?: (element: Element) => number;
}) => {
  const itemSize = estimateSize();
  
  return {
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
    scrollToIndex: vi.fn(),
    measureElement: vi.fn(),
    scrollToOffset: vi.fn(),
    measure: vi.fn(),
    options: {
      count,
      estimateSize,
      overscan: 5,
    },
  };
};
