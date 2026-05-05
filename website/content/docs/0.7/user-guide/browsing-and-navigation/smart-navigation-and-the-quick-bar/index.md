+++
title = "Smart Navigation and the Quick Bar"
description = "Jump to directories quickly with Ctrl+K, use the shared quick bar for commands and settings, and filter the current pane without leaving the keyboard."
+++

The quick bar is one of Sambee's core navigation features.

If you have used Visual Studio Code, the model will feel familiar: one shared bar can help you jump, filter, and run commands without digging through the interface first.

## Jump to a Directory Fast with Smart Navigation

Press <kbd>Ctrl</kbd> + <kbd>K</kbd> to open smart navigation.

Smart navigation is designed for the moment when you know roughly where you want to go, but do not want to click through each directory level to get there.

Use it when you want to:

- jump to another directory tree by remembering only part of the target name
- move across large folder structures more quickly than browsing level by level
- stay in a keyboard-driven workflow while changing location

In practice, that means you can type part of a directory name, choose the match you want, and jump there immediately.

You do not need to remember the full path. Remembering a meaningful fragment of the target name is often enough.

## One Bar, Multiple Uses

The quick bar is not only for directory jumping.

It is a shared bar with multiple modes:

- smart navigation with <kbd>Ctrl</kbd> + <kbd>K</kbd>
- command mode with <kbd>Ctrl</kbd> + <kbd>P</kbd> or <kbd>F1</kbd>
- current-pane filtering with <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>F</kbd>

That multi-use design is why the bar feels familiar to many VS Code users. The same entry point becomes a fast keyboard surface for navigation, commands, and filtering.

## Open Commands and Settings

Use command mode when you know what you want to do, but do not want to hunt for the button first.

Open it with <kbd>Ctrl</kbd> + <kbd>P</kbd> or <kbd>F1</kbd>.

From there, you can reach actions such as:

- opening settings
- switching to other browser actions
- reaching features that are easier to trigger by name than by pointer navigation

## Filter the Current Pane without Leaving the Keyboard

Use <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>F</kbd> when you do not want to jump somewhere else and instead want to narrow the file list you are already looking at.

This mode filters the current pane or view directly.

- typing immediately narrows the visible file list
- the filter belongs to the pane you opened it from
- in dual-pane mode, each pane keeps its own filter state

This is different from smart navigation:

- smart navigation helps you move to another location
- filter mode helps you work faster inside the current location

## Which Mode Should You Use?

Choose the mode based on intent:

- use smart navigation when you want to jump to another directory quickly
- use command mode when you want to trigger an action such as opening settings
- use filter mode when you want to narrow the files in the current pane

## Work Well with Dual Pane

The bar works with Sambee's active-pane model.

That matters most in dual-pane workflows:

- smart navigation opens for the pane you are working in
- current-directory filtering applies to the pane that opened it
- you can jump or filter without losing the broader two-pane workflow

For side-by-side browsing, copy, and move workflows, continue with [Dual-Pane Mode](../dual-pane-mode/).
