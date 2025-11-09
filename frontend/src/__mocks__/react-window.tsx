/**
 * Auto-discovered mock for react-window
 * Vitest automatically uses this when vi.mock('react-window') is called
 */

import React, { type ComponentType } from "react";

/**
 * Mock for List component - renders all items without virtualization
 */
export const List = ({
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
  );

/**
 * Mock for FixedSizeList component - renders all items without virtualization
 */
export const FixedSizeList = ({
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
  );
