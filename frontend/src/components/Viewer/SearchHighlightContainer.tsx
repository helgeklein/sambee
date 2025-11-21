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
export const SearchHighlightContainer: React.FC<SearchHighlightContainerProps> = ({
  currentMatchIndex,
}) => {
  const { highlight, isScrolledTo } = useHighlightContainerContext<Highlight>();

  // Extract match index from highlight ID (format: "search-{page}-{index}")
  const highlightIndex = highlight.id.startsWith("search-")
    ? Number.parseInt(highlight.id.split("-").slice(2).join("-"), 10)
    : -1;

  const isCurrentMatch = highlightIndex === currentMatchIndex;
  const isTextHighlight = !highlight.content?.image;

  // Yellow for regular matches, orange for current match
  const highlightColor = isCurrentMatch ? "rgba(255, 152, 0, 0.4)" : "rgba(255, 235, 59, 0.4)";

  if (isTextHighlight) {
    return (
      <TextHighlight
        isScrolledTo={isScrolledTo}
        highlight={highlight}
        style={{ background: highlightColor }}
      />
    );
  }

  return (
    <AreaHighlight
      isScrolledTo={isScrolledTo}
      highlight={highlight}
      style={{ background: highlightColor }}
    />
  );
};
