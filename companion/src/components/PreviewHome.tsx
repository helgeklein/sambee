import type { CompanionPreviewDefinition } from "../previews";
import "../styles/preview-home.css";

interface PreviewHomeProps {
  previews: CompanionPreviewDefinition[];
}

/** Browser-only landing page for discoverable companion UI previews. */
export function PreviewHome({ previews }: PreviewHomeProps) {
  return (
    <main class="preview-home">
      <div class="preview-home__hero">
        <p class="preview-home__eyebrow">Sambee Companion</p>
        <h1 class="preview-home__title">UI Preview Index</h1>
        <p class="preview-home__body">
          Open individual companion dialogs in isolation. Add new previews to the shared registry so they automatically appear here.
        </p>
      </div>

      <section class="preview-home__grid" aria-label="Available companion previews">
        {previews.map((preview) => (
          <a key={preview.path} class="preview-home__card" href={preview.path}>
            <h2 class="preview-home__card-title">{preview.title}</h2>
            <p class="preview-home__card-body">{preview.description}</p>
            <span class="preview-home__card-link">Open preview</span>
          </a>
        ))}
      </section>
    </main>
  );
}
