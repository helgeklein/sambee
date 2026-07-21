+++
title = "Docs Style Guide"
+++

Use this page as the canonical copy style reference for published docs.

## Language

- Use simple but correct language.
- Don't be nitpicky.

## Lists

### Sentence Style

Use one list style per list. Do not mix sentence bullets and fragment bullets.

- Sentence lists use complete sentences.
   - Sentence bullets start with a capital letter and end with a full stop.
   - After a colon, capitalize the next word when what follows is a sentence.
- Fragment lists use short labels, file names, commands, paths, shortcuts, or other bare literals.
   - Fragment bullets preserve literal casing and usually do not take a full stop.
   - Prefer short, parallel labels for control or feature lists, for example `Zoom`, `Pan`, `Rotate`.
   - If a fragment needs explanation, rewrite it as a sentence bullet or use a table.

Preferred sentence list:

```markdown
- Focus matters: Shortcuts act on the item that currently has focus.
- The active pane matters: In dual-pane mode, many browser commands target the currently active pane.
- Important actions stay discoverable: The same actions are also available through visible controls and the in-app shortcuts help.
```

Valid fragment list:

```markdown
- `config.toml`
- `website/content/docs/`
- `Ctrl` + `K`
```

### List Structure

- Make use of multiple hierarchies to structure content.
- Mixing ordered and unordered lists is allowed.

### Ordered Lists

- Don't number ordered lists consecutively, use `1.` for all items. Let the Markdown renderer do the numbering.

## Headings

- Use multiple heading levels to logically group and structure content. Don't limit yourself to h2.

## More Information

See [Docs Authoring Workflow](../docs-authoring-workflow/) for where copy edits fit into the docs workflow, and [Docs Editor Tool](../docs-editor-tool/) for structural docs changes.
