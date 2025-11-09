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
 * Lazy mock for MarkdownPreview component
 * Simple placeholder for preview tests
 */
export function createMarkdownPreviewMock() {
  return {
    default: () =>
      React.createElement(
        "div",
        { role: "dialog", "data-testid": "markdown-preview" },
        "Markdown Preview"
      ),
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
  vi.mock("../../components/Preview/MarkdownPreview", () => createMarkdownPreviewMock());
  vi.mock("../../components/Settings/SettingsDialog", () => createSettingsDialogMock());
}

/**
 * Setup only react-window mock
 */
export function setupReactWindowMock() {
  vi.mock("react-window", () => createReactWindowMock());
}

/**
 * Setup only MarkdownPreview mock
 */
export function setupMarkdownPreviewMock() {
  vi.mock("../../components/Preview/MarkdownPreview", () => createMarkdownPreviewMock());
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
