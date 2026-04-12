import {
  contentEditableRef$,
  createRootEditorSubscription$,
  editorSearchCursor$,
  editorSearchRanges$,
  editorSearchScrollableContent$,
  editorSearchTerm$,
  editorSearchTextNodeIndex$,
  MDX_FOCUS_SEARCH_NAME,
  MDX_SEARCH_NAME,
  rangeSearchScan,
  realmPlugin,
  type TextNodeIndex,
} from "@mdxeditor/editor";

const EMPTY_TEXT_NODE_INDEX: TextNodeIndex = {
  allText: "",
  nodeIndex: [],
  offsetIndex: [],
};

export function indexEditorSearchTextNodes(root: Node | null): TextNodeIndex {
  let allText = "";
  const nodeIndex: Node[] = [];
  const offsetIndex: number[] = [];

  if (!root) {
    return EMPTY_TEXT_NODE_INDEX;
  }

  const contentSelector = "p, h1, h2, h3, h4, h5, h6, li, code, pre";
  const treeWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, (node) => {
    if (node.parentElement?.closest(contentSelector)) {
      return NodeFilter.FILTER_ACCEPT;
    }

    return NodeFilter.FILTER_REJECT;
  });

  let currentNode = treeWalker.nextNode();
  while (currentNode) {
    const nodeContent = currentNode.textContent ?? "";

    for (let index = 0; index < nodeContent.length; index += 1) {
      nodeIndex.push(currentNode);
      offsetIndex.push(index);
      allText += nodeContent[index] ?? "";
    }

    currentNode = treeWalker.nextNode();
  }

  return { allText, nodeIndex, offsetIndex };
}

function focusHighlightRange(range: Range | undefined): void {
  CSS.highlights.delete(MDX_FOCUS_SEARCH_NAME);

  if (range) {
    CSS.highlights.set(MDX_FOCUS_SEARCH_NAME, new Highlight(range));
  }
}

function highlightRanges(ranges: Range[]): void {
  CSS.highlights.set(MDX_SEARCH_NAME, new Highlight(...ranges));
}

function resetHighlights(): void {
  CSS.highlights.delete(MDX_SEARCH_NAME);
  CSS.highlights.delete(MDX_FOCUS_SEARCH_NAME);
}

function scrollToRange(
  range: Range,
  contentEditable: HTMLElement | null,
  options?: { ignoreIfInView?: boolean; behavior?: ScrollBehavior }
): void {
  const ignoreIfInView = options?.ignoreIfInView ?? true;
  const behavior = options?.behavior ?? "smooth";
  const [firstRect] = range.getClientRects();

  if (!contentEditable || !firstRect) {
    return;
  }

  const containerRect = contentEditable.getBoundingClientRect();
  const topRelativeToContainer = firstRect.top - containerRect.top;
  const bottomRelativeToContainer = firstRect.bottom - containerRect.top;

  if (ignoreIfInView) {
    const rangeTop = topRelativeToContainer + contentEditable.scrollTop;
    const rangeBottom = bottomRelativeToContainer + contentEditable.scrollTop;
    const visibleTop = contentEditable.scrollTop;
    const visibleBottom = visibleTop + contentEditable.clientHeight;
    const inView = rangeTop >= visibleTop && rangeBottom <= visibleBottom;

    if (inView) {
      return;
    }
  }

  const top = topRelativeToContainer + contentEditable.scrollTop - firstRect.height;
  contentEditable.scrollTo({ top, behavior });
}

export const mdxEditorSearchPlugin = realmPlugin({
  init(realm) {
    if (typeof CSS.highlights === "undefined") {
      console.warn("CSS.highlights is not supported in this browser. Search functionality will be limited.");
      return;
    }

    realm.sub(editorSearchCursor$, (cursor) => {
      const ranges = realm.getValue(editorSearchRanges$);
      focusHighlightRange(ranges[cursor - 1]);
    });

    const updateHighlights = (searchQuery: string, textNodeIndex: TextNodeIndex) => {
      if (!searchQuery) {
        realm.pub(editorSearchCursor$, 0);
        realm.pub(editorSearchRanges$, []);
        resetHighlights();
        return;
      }

      const ranges = Array.from(rangeSearchScan(searchQuery, textNodeIndex));
      realm.pub(editorSearchRanges$, ranges);
      highlightRanges(ranges);

      if (ranges.length === 0) {
        resetHighlights();
        return;
      }

      const currentCursor = realm.getValue(editorSearchCursor$) || 1;
      const currentRange = ranges[currentCursor - 1];

      if (!currentRange) {
        resetHighlights();
        realm.pub(editorSearchCursor$, 0);
        return;
      }

      focusHighlightRange(currentRange);
      realm.pub(editorSearchCursor$, currentCursor);
      scrollToRange(currentRange, realm.getValue(editorSearchScrollableContent$), {
        ignoreIfInView: true,
      });
    };

    realm.sub(editorSearchTextNodeIndex$, (textNodeIndex) => {
      updateHighlights(realm.getValue(editorSearchTerm$), textNodeIndex);
    });

    realm.sub(editorSearchTerm$, (searchQuery) => {
      updateHighlights(searchQuery, realm.getValue(editorSearchTextNodeIndex$));
    });

    realm.pub(createRootEditorSubscription$, (editor) => {
      let observer: MutationObserver | null = null;

      return editor.registerRootListener((rootElement) => {
        observer?.disconnect();
        observer = null;

        if (!rootElement) {
          realm.pub(editorSearchTextNodeIndex$, EMPTY_TEXT_NODE_INDEX);
          return;
        }

        realm.pub(editorSearchTextNodeIndex$, indexEditorSearchTextNodes(rootElement));

        observer = new MutationObserver(() => {
          realm.pub(editorSearchTextNodeIndex$, indexEditorSearchTextNodes(rootElement));
        });

        observer.observe(rootElement, {
          childList: true,
          subtree: true,
          characterData: true,
        });

        return () => {
          observer?.disconnect();
        };
      });
    });

    realm.sub(contentEditableRef$, (contentEditableRef) => {
      realm.pub(
        editorSearchScrollableContent$,
        contentEditableRef?.current?.parentNode instanceof HTMLElement ? contentEditableRef.current.parentNode : null
      );
    });
  },
});
