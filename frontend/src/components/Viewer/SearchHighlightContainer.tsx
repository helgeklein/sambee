import React from "react";
import type { Highlight } from "react-pdf-highlighter-extended";
import {
  AreaHighlight,
  TextHighlight,
  useHighlightContainerContext,
} from "react-pdf-highlighter-extended";

interface SearchHighlightContainerProps {
  currentMatchIndex: number;
}

/**
 * Custom highlight container for rendering search results
 * Highlights current match differently from other matches
 */
export const SearchHighlightContainer: React.FC<SearchHighlightContainerProps> = React.memo(
  ({ currentMatchIndex }) => {
    const { highlight, isScrolledTo } = useHighlightContainerContext<Highlight>();

    // Extract match index from highlight ID (format: "search-{index}")
    const highlightIndex = highlight.id.startsWith("search-")
      ? Number.parseInt(highlight.id.substring(7), 10)
      : -1;

    const isCurrentMatch = highlightIndex === currentMatchIndex;
    const isTextHighlight = !highlight.content?.image;

    // Use very bright colors with explicit positioning for debugging visibility
    const highlightStyle: React.CSSProperties = isCurrentMatch
      ? {
          background: "rgba(255, 152, 0, 0.8)",
          opacity: 1,
          zIndex: 10,
          pointerEvents: "auto",
        }
      : {
          background: "rgba(255, 235, 59, 0.6)",
          opacity: 1,
          zIndex: 9,
          pointerEvents: "auto",
        };

    if (isTextHighlight) {
      return (
        <TextHighlight isScrolledTo={isScrolledTo} highlight={highlight} style={highlightStyle} />
      );
    }

    return (
      <AreaHighlight isScrolledTo={isScrolledTo} highlight={highlight} style={highlightStyle} />
    );
  }
);

SearchHighlightContainer.displayName = "SearchHighlightContainer";
