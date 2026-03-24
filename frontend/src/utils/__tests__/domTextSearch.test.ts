import { describe, expect, it } from "vitest";
import {
  activateDomTextSearchMatch,
  applyDomTextSearchHighlights,
  clearDomTextSearchHighlights,
  DOM_TEXT_SEARCH_CURRENT_MATCH_ATTRIBUTE,
  DOM_TEXT_SEARCH_HIGHLIGHT_SELECTOR,
  DOM_TEXT_SEARCH_MATCH_ID_ATTRIBUTE,
} from "../domTextSearch";

describe("domTextSearch", () => {
  it("highlights case-insensitive matches within text nodes", () => {
    const container = document.createElement("div");
    container.innerHTML = "<p>Alpha beta ALPHA</p>";

    const matches = applyDomTextSearchHighlights(container, "alpha");

    expect(matches).toHaveLength(2);
    expect(container.querySelectorAll(DOM_TEXT_SEARCH_HIGHLIGHT_SELECTOR)).toHaveLength(2);
  });

  it("activates the requested current match", () => {
    const container = document.createElement("div");
    container.innerHTML = "<p>Alpha beta alpha</p>";

    const matches = applyDomTextSearchHighlights(container, "alpha");
    const activeHighlight = activateDomTextSearchMatch(matches, 2);

    expect(activeHighlight).toBe(matches[1]?.elements[0]);
    expect(matches[0]?.elements[0]?.hasAttribute(DOM_TEXT_SEARCH_CURRENT_MATCH_ATTRIBUTE)).toBe(false);
    expect(matches[1]?.elements[0]?.getAttribute(DOM_TEXT_SEARCH_CURRENT_MATCH_ATTRIBUTE)).toBe("true");
  });

  it("matches a term across inline element boundaries as a single logical match", () => {
    const container = document.createElement("div");
    container.innerHTML = "<p>sam<strong>bee</strong> sambee</p>";

    const matches = applyDomTextSearchHighlights(container, "sambee");

    expect(matches).toHaveLength(2);
    expect(matches[0]?.elements).toHaveLength(2);
    expect(matches[1]?.elements).toHaveLength(1);
    expect(container.querySelectorAll(DOM_TEXT_SEARCH_HIGHLIGHT_SELECTOR)).toHaveLength(3);
    expect(matches[0]?.elements[0]?.getAttribute(DOM_TEXT_SEARCH_MATCH_ID_ATTRIBUTE)).toBe("0");
    expect(matches[0]?.elements[1]?.getAttribute(DOM_TEXT_SEARCH_MATCH_ID_ATTRIBUTE)).toBe("0");
  });

  it("does not create false matches across block boundaries", () => {
    const container = document.createElement("div");
    container.innerHTML = "<p>sam</p><p>bee</p>";

    const matches = applyDomTextSearchHighlights(container, "sambee");

    expect(matches).toHaveLength(0);
    expect(container.querySelectorAll(DOM_TEXT_SEARCH_HIGHLIGHT_SELECTOR)).toHaveLength(0);
  });

  it("clears highlights and restores the original text content", () => {
    const container = document.createElement("div");
    container.innerHTML = "<p>Alpha <strong>beta</strong> alpha</p>";

    applyDomTextSearchHighlights(container, "alpha");
    clearDomTextSearchHighlights(container);

    expect(container.querySelectorAll(DOM_TEXT_SEARCH_HIGHLIGHT_SELECTOR)).toHaveLength(0);
    expect(container.textContent).toBe("Alpha beta alpha");
  });
});
