type TextMeasurer = (text: string) => number;

const ELLIPSIS = "...";

function shortenTextFromStart(text: string, availableWidth: number, measureText: TextMeasurer): string {
  if (availableWidth <= 0 || measureText(text) <= availableWidth) {
    return text;
  }

  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (measureText(`${ELLIPSIS}${text.slice(middle)}`) <= availableWidth) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }

  return `${ELLIPSIS}${text.slice(low)}`;
}

/** Preserve the connection/root prefix and basename while collapsing ancestor directories to fit. */
export function abbreviatePath(path: string, availableWidth: number, measureText: TextMeasurer): string {
  if (availableWidth <= 0 || measureText(path) <= availableWidth) {
    return path;
  }

  const separator = path.includes("\\") && !path.includes("/") ? "\\" : "/";
  const prefixedRoot = path.match(/^([^/\\]+):[\\/]/)?.[0];
  const root = prefixedRoot ?? (path.startsWith(separator) ? separator : "");
  const segments = path.slice(root.length).split(/[\\/]/).filter(Boolean);
  const basename = segments.pop();
  if (!basename) {
    return path;
  }

  const abbreviatedBasename = (includeAncestorIndicator: boolean) => {
    const text = includeAncestorIndicator ? `${ELLIPSIS}${basename}` : basename;
    if (!prefixedRoot || measureText(prefixedRoot) >= availableWidth) {
      return shortenTextFromStart(text, availableWidth, measureText);
    }
    return `${prefixedRoot}${shortenTextFromStart(text, availableWidth - measureText(prefixedRoot), measureText)}`;
  };

  if (measureText(basename) > availableWidth || segments.length === 0) {
    return abbreviatedBasename(false);
  }

  const prefix = `${root}${ELLIPSIS}${separator}`;
  let shortened = `${prefix}${basename}`;
  if (measureText(shortened) > availableWidth) {
    return abbreviatedBasename(true);
  }

  while (segments.length > 0) {
    const candidate = `${prefix}${segments.at(-1)}${separator}${shortened.slice(prefix.length)}`;
    if (measureText(candidate) > availableWidth) {
      break;
    }
    shortened = candidate;
    segments.pop();
  }

  return shortened;
}
