/**
 * Lazy Mocks - Lazy Loading for Heavy Component Mocks
 * Optimizes test loading by providing lazy factory functions
 */

import React, { type ComponentType } from "react";
import { vi } from "vitest";

/**
 * Lazy mock for react-window List component
 * Only loads when actually used in tests
 */
export function createReactWindowMock() {
  return {
    List: ({
      rowComponent: RowComponent,
      rowCount,
      rowProps,
    }: {
      // biome-ignore lint/suspicious/noExplicitAny: Mock requires flexible types for component props
      rowComponent: ComponentType<any>;
      rowCount: number;
      // biome-ignore lint/suspicious/noExplicitAny: Mock requires flexible types for row props
      rowProps?: any;
    }) =>
      React.createElement(
        "div",
        { "data-testid": "virtual-list" },
        Array.from({ length: rowCount }).map((_, index) =>
          React.createElement(RowComponent, {
            key: index,
            index,
            style: {},
            ...rowProps,
          })
        )
      ),
    FixedSizeList: ({
      children,
      itemCount,
    }: {
      // biome-ignore lint/suspicious/noExplicitAny: Mock requires flexible types
      children: any;
      itemCount: number;
    }) =>
      React.createElement(
        "div",
        { "data-testid": "fixed-size-list" },
        Array.from({ length: itemCount }).map((_, index) => children({ index, style: {} }))
      ),
  };
}

/**
 * Lazy mock for MarkdownViewer component
 * Simple placeholder for viewer tests
 */
export function createMarkdownViewerMock() {
  return {
    default: () => React.createElement("div", { role: "dialog", "data-testid": "markdown-viewer" }, "Markdown Viewer"),
  };
}

/**
 * Lazy mock for PDFViewer component
 * Simple placeholder for viewer tests
 */
export function createPDFViewerMock() {
  return {
    default: () => React.createElement("div", { role: "dialog", "data-testid": "pdf-viewer" }, "PDF Viewer"),
  };
}

/**
 * Lazy mock for SettingsDialog component
 * Interactive mock for testing dialog behaviors
 */
export function createSettingsDialogMock() {
  return {
    default: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
      open
        ? React.createElement(
            "div",
            { "data-testid": "settings-dialog" },
            React.createElement("button", { type: "button", onClick: onClose }, "Close Settings")
          )
        : null,
  };
}

/**
 * Setup all common mocks using lazy factories
 * Call this in test files that need these mocks
 */
export function setupLazyMocks() {
  vi.mock("react-window", () => createReactWindowMock());
  vi.mock("../../components/Viewer/MarkdownViewer", () => createMarkdownViewerMock());
  vi.mock("../../components/Viewer/PDFViewer", () => createPDFViewerMock());
  vi.mock("../../components/Settings/SettingsDialog", () => createSettingsDialogMock());
}

/**
 * Setup only react-window mock
 */
export function setupReactWindowMock() {
  vi.mock("react-window", () => createReactWindowMock());
}

/**
 * Setup only MarkdownViewer mock
 */
export function setupMarkdownViewerMock() {
  vi.mock("../../components/Viewer/MarkdownViewer", () => createMarkdownViewerMock());
}

/**
 * Setup only PDFViewer mock
 */
export function setupPDFViewerMock() {
  vi.mock("../../components/Viewer/PDFViewer", () => createPDFViewerMock());
}

/**
 * Setup only SettingsDialog mock
 */
export function setupSettingsDialogMock() {
  vi.mock("../../components/Settings/SettingsDialog", () => createSettingsDialogMock());
}

/**
 * Create a generic component mock
 * Useful for mocking any component with a simple placeholder
 */
export function createGenericComponentMock(testId: string, displayName = "MockComponent") {
  return {
    default: () => React.createElement("div", { "data-testid": testId }, displayName),
  };
}

/**
 * Light mocks - Minimal component mocks for simple render tests
 * Use these for basic tests that don't need full component functionality
 * Significantly faster collection time than full mocks
 */
export function createLightMocks() {
  return {
    MarkdownViewer: () => null,
    PDFViewer: () => null,
    SettingsDialog: () => null,
    List: ({ children }: { children: React.ReactNode }) => React.createElement("div", { "data-testid": "light-list" }, children),
  };
}

/**
 * Create light react-window mock
 * Returns just null to minimize rendering overhead
 */
export function createLightReactWindowMock() {
  const LightList = () => React.createElement("div", { "data-testid": "light-list" });
  return {
    List: LightList,
    FixedSizeList: LightList,
  };
}

/**
 * Create light MarkdownViewer mock
 * Returns null to skip viewer rendering
 */
export function createLightMarkdownViewerMock() {
  return {
    default: () => null,
  };
}

/**
 * Create light PDFViewer mock
 * Returns null to skip viewer rendering
 */
export function createLightPDFViewerMock() {
  return {
    default: () => null,
  };
}

/**
 * Create light SettingsDialog mock
 * Returns null to skip dialog rendering
 */
export function createLightSettingsDialogMock() {
  return {
    default: () => null,
  };
}
