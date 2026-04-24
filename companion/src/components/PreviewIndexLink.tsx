import "../styles/preview-navigation.css";

interface PreviewIndexLinkProps {
  className?: string;
}

/** Shared link back to the browser preview index. */
export function PreviewIndexLink({ className }: PreviewIndexLinkProps) {
  return (
    <a class={["preview-index-link", className ?? ""].filter(Boolean).join(" ")} href="/">
      Preview Index
    </a>
  );
}
