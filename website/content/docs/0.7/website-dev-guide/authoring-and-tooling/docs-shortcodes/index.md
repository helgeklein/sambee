+++
title = "Docs Shortcodes"
+++

Use this page when you need a docs-only Hugo shortcode in published documentation content.

## Current Shortcodes

The website currently exposes one docs shortcode for normal content authors:

- `admonition`: render a styled callout block for notes, tips, warnings, and similar emphasis

## Admonition Shortcode

Use the `admonition` shortcode for highlighted callout content inside a docs page.

Basic form:

```md
{{</* admonition type="info" title="Info" */>}}
This is an informational callout.
{{</* /admonition */>}}
```

The body is rendered as normal Markdown, so links, emphasis, lists, and other inline formatting work inside the block.

### Supported Types

The shortcode supports these `type` values:

- `note`
- `tip`
- `info`
- `warning`
- `danger`

If `type` is omitted or invalid, it defaults to `note`.

### Title Behavior

The `title` parameter is optional.

- If you provide a non-empty title, the admonition renders a title line.
- If you omit `title`, no title line is rendered.

### Examples

#### Note Callout

```md
{{</* admonition type="note" */>}}
This is a note without a title.
{{</* /admonition */>}}
```

{{< admonition type="note" >}}
This is a note without a title.
{{< /admonition >}}

#### Tip Callout

```md
{{</* admonition type="tip" title="Tip" */>}}
Keep admonitions rare so they still mean something when readers encounter them.
{{</* /admonition */>}}
```

{{< admonition type="tip" title="Tip" >}}
Keep admonitions rare so they still mean something when readers encounter them.
{{< /admonition >}}

#### Informational Callout

```md
{{</* admonition type="info" title="Background" */>}}
The docs editor updates both the content tree and the docs navigation data.
{{</* /admonition */>}}
```

{{< admonition type="info" title="Background" >}}
The docs editor updates both the content tree and the docs navigation data.
{{< /admonition >}}

#### Warning Callout

```md
{{</* admonition type="warning" title="Do Not Edit Marker Files" */>}}
Do not add front matter or body content to `inherit.md` or `_inherit.md` files.
{{</* /admonition */>}}
```

{{< admonition type="warning" title="Do Not Edit Marker Files" >}}
Do not add front matter or body content to `inherit.md` or `_inherit.md` files.
{{< /admonition >}}

#### Danger Callout

```md
{{</* admonition type="danger" title="Destructive Change" */>}}
Deleting or renaming docs structure manually can desynchronize navigation and inherited versions.
{{</* /admonition */>}}
```

{{< admonition type="danger" title="Destructive Change" >}}
Deleting or renaming docs structure manually can desynchronize navigation and inherited versions.
{{< /admonition >}}

### Implementation Reference

The shortcode implementation lives in `themes/sambee/layouts/shortcodes/admonition.html`.

The styling for the rendered admonition variants lives in `themes/sambee/assets/css/content.css`.
