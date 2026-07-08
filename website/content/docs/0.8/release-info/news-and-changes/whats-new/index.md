+++
title = "What's New"
+++

## Quick Bar: UX

The [quick bar](../../../user-guide/browsing-and-navigation/smart-navigation-and-the-quick-bar/) is Sambee's main navigation element. It sits in the top bar above the file list and is designed to be the single point of control for directory navigation, file list filtering, and command lookup and execution.

Previously, those three functions were not clearly distinguished. The three modes are now separated more distinctly, and the current mode is shown directly in the quick bar through a dedicated button. This makes the feature easier to discover and also allows users to switch modes with the mouse or by touch (in addition to the existing keyboard shortcuts).

In addition, several bugs were fixed to improve the overall experience.

## Companion: More Secure Pairing & Communication Flows

This release makes Sambee Companion connections more secure, from the first pairing step through ongoing communication during local-drive access and desktop editing.

**Pairing** is now tracked per Sambee site instead of through one global paired state, pending approvals can be cancelled cleanly, and the browser now shows clearer states when Companion is unavailable, waiting for local approval, needs repair, or has lost its editing session.

Sambee also now trusts only the specific Sambee site you approved, limits what the local Companion service exposes, and uses narrower one-task-at-a-time edit credentials behind the scenes.

**Native editing** is also more resilient. Sambee now uses tighter, task-specific edit permissions, renews long-running edit sessions when needed, and returns you to the browser with a clearer next step if sign-in, lock ownership, or recovery fails, instead of leaving you stuck with a vague error.

## File Opening: Speed & Flexibility

When opening files for previewing or editing, you want quick previews, but you also want the ability to choose which app a file is opened in. Both paths are now efficiently available:

Opening in Sambee's viewers in the browser:

- Clicking a file or pressing <kbd>Enter</kbd> opens the file in Sambee's associated viewer.
- If no associated viewer exists or if <kbd>Shift + Enter</kbd> is pressed, a viewer picker dialog is shown.
   - This viewer picker allows choosing a Sambee browser viewer as well as a native app.

Opening in natively installed apps:

- To open a file in the associated native app, press <kbd>Ctrl + Enter</kbd> (or right-click and select **open in native app**).
- If no associated native app has been chosen yet or if <kbd>Ctrl + Alt + Enter</kbd> is pressed, an app picker dialog is shown.

## Markdown Editor: Strategy Change

Let's put it plainly: the WYSIWYG Markdown editor is gone. Sad but true. The reason is plain and simple: UX. AFAIK, there's not a single open-source rich-text Markdown editor with WYSIWYG editing that comes with great user experience. As I found out, MDXEditor is certainly not up to the task. That means: out.

The actually better option: take one of the best available editors, CodeMirror, and wire it up for Markdown - but also generic text editing. This provides a best-in-class editing experience with amazing UX. It also gives us battle-tested addons that implement many of the little quality-of-life features we've become accustomed to through decades of coding and editing experience.

## PDF Viewer

Fixes:

- Intra-document links now work correctly, e.g. from a table of contents.

## Internals

### Documentation System

Sambee has a best-in-class documentation system that deduplicates content, inheriting unchanged text copy through versions. This enables us to provide complete and accurate docs for each product version while minimizing maintenance effort.

This release adds a new docs reporting and visualization tool that creates an HTML report of all docs books, sections, and pages with their respective properties (e.g., inherited, branched). The report also has a diff view that highlights changes between any two document versions.

Docs editor tool improvements:

- UI improvements (e.g., better help output)
- New commands to convert pages between inherited and independent: `page materialize` and `page inherit`
- Test & validation suite that is also called in CI
