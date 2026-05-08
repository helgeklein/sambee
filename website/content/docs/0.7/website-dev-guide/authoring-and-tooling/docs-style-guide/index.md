+++
title = "Docs Style Guide"
+++

Use this page as the canonical copy style reference for published docs.

## List Style

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

See [Docs Authoring Workflow](../docs-authoring-workflow/) for where copy edits fit into the docs workflow, and [Docs Editor Tool](../docs-editor-tool/) for structural docs changes.
