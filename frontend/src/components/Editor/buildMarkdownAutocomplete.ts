import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionSource,
  completeFromList,
  snippetCompletion,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";

function field(name: string): string {
  return `\${${name}}`;
}

export const MARKDOWN_SNIPPET_COMPLETIONS: readonly Completion[] = [
  snippetCompletion(`# ${field("title")}`, {
    label: "h1",
    detail: "Heading 1",
    type: "keyword",
  }),
  snippetCompletion(`## ${field("title")}`, {
    label: "h2",
    detail: "Heading 2",
    type: "keyword",
  }),
  snippetCompletion(`### ${field("title")}`, {
    label: "h3",
    detail: "Heading 3",
    type: "keyword",
  }),
  snippetCompletion(`- ${field("item")}`, {
    label: "ul",
    detail: "Bulleted list",
    type: "keyword",
  }),
  snippetCompletion(`- [ ] ${field("item")}`, {
    label: "task",
    detail: "Task list item",
    type: "keyword",
  }),
  snippetCompletion(`> ${field("quote")}`, {
    label: "quote",
    detail: "Blockquote",
    type: "keyword",
  }),
  snippetCompletion(`[${field("label")}](https://${field("url")})`, {
    label: "link",
    detail: "Markdown link",
    type: "keyword",
  }),
  snippetCompletion(`![${field("alt")}](https://${field("url")})`, {
    label: "image",
    detail: "Markdown image",
    type: "keyword",
  }),
  snippetCompletion(`\`\`\`\n${field("code")}\n\`\`\``, {
    label: "code",
    detail: "Code block",
    type: "keyword",
  }),
  snippetCompletion(`\`\`\` ${field("language")}\n${field("code")}\n\`\`\``, {
    label: "fence",
    detail: "Code fence with language",
    type: "keyword",
  }),
  snippetCompletion(`| ${field("column1")} | ${field("column2")} |\n| --- | --- |\n| ${field("value1")} | ${field("value2")} |`, {
    label: "table",
    detail: "Markdown table",
    type: "keyword",
  }),
];

const markdownSnippetSource = completeFromList(MARKDOWN_SNIPPET_COMPLETIONS);

const markdownAutocompleteSource: CompletionSource = (context: CompletionContext) => {
  const word = context.matchBefore(/[A-Za-z][A-Za-z0-9-]*/);

  if (!context.explicit && (!word || word.from === word.to)) {
    return null;
  }

  return markdownSnippetSource(context);
};

export function buildMarkdownAutocomplete(): Extension {
  return autocompletion({
    override: [markdownAutocompleteSource],
    activateOnTyping: true,
    icons: false,
  });
}
