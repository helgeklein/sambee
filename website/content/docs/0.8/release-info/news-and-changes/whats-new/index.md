+++
title = "What's New"
+++

## Quick Bar UX Improvements

The [quick bar](../../../user-guide/browsing-and-navigation/smart-navigation-and-the-quick-bar/) is Sambee's main navigation element. It sits in the top bar above the file list and is designed to be the single point of control for directory navigation, file list filtering, and command lookup and execution.

Previously, those three functions were not clearly distinguished. The three modes are now separated more distinctly, and the current mode is shown directly in the quick bar through a dedicated button. This makes the feature easier to discover and also allows users to switch modes with the mouse or by touch (in addition to the existing keyboard shortcuts).

In addition, several bugs were fixed to improve the overall experience.

## Internals

### Documentation System

Sambee has a best-in-class documentation system that deduplicates content, inheriting unchanged text copy through versions. This enables us to provide complete and accurate docs for each product version while minimizing maintenance effort.

This release adds a new docs reporting and visualization tool that creates an HTML report of all docs books, sections, and pages with their respectice properties (e.g., inherited, branched). The report also has a diff view that highlights changes between any two document versions.

Docs editor tool improvements:

- UI improvements (e.g., better help output)
- New commands to convert pages between inherited and independent: `page materialize` and `page inherit`
- Test & validation suite that is also called in CI
